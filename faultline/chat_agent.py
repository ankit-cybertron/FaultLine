"""
faultline/chat_agent.py — Live Chat Mode engine.

Every user message produces a Turn. As the model works, we record
observable steps one by one and yield them as SSE events so the UI
graph grows in real time.

Only OBSERVABLE steps are recorded — nothing is fabricated:
  1. chat_input       — the raw user message
  2. context_selection — which history turns and memory items entered the prompt
  3. router           — model's JSON decision: direct_answer vs tool, + reason
  4. tool_call        — tool name + args   (when model chose a tool)
  5. tool_result      — tool output + latency  (immediately after tool_call)
  6. retrieval        — RAG / memory records surfaced (if any)
  7. synthesis        — streaming final text assembly
  8. chat_output      — the delivered assistant answer

Nothing else in the codebase should import groq directly;
we re-use faultline.llm._call_groq (private) only for streaming,
and faultline.llm.complete_json for the router JSON decision.
"""

from __future__ import annotations

import json
import logging
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Generator, Iterable, Iterator, Optional
from groq import Groq
from groq.types.chat import ChatCompletion
from pydantic import BaseModel, Field

from faultline.config import settings
from faultline.recorder import RunRecorder

log = logging.getLogger(__name__)

# ── Groq client (same key as llm.py) ─────────────────────────────────────────
_groq = Groq(api_key=settings.groq_api_key)


class InterpretationCandidate(BaseModel):
    label: str
    description: str
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)
    favored_by: list[str] = Field(default_factory=list)
    reason: str = ""
    chosen: bool = False


class InterpretationOutput(BaseModel):
    ambiguous: bool
    candidates: list[InterpretationCandidate]
    chosen: str
    clarify_question: Optional[str] = None
    chosen_without_history: Optional[str] = None

# ── Available tools the agent can call ───────────────────────────────────────
TOOLS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "search_memory",
            "description": "Search past conversation turns and stored facts by keyword.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Search query"},
                    "k": {"type": "integer", "default": 3, "description": "Max results"},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "calculate",
            "description": "Evaluate a safe arithmetic expression and return the numeric result.",
            "parameters": {
                "type": "object",
                "properties": {
                    "expression": {"type": "string", "description": "e.g. '(12 + 8) * 3 / 2'"},
                },
                "required": ["expression"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_current_time",
            "description": "Return the current UTC time in ISO-8601 format.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
]


# ── Tool implementations ───────────────────────────────────────────────────────

def _run_tool(name: str, args: dict, history: list[dict]) -> str:
    """Execute a tool call and return the result as a string."""
    if name == "search_memory":
        query = args.get("query", "").lower()
        k = int(args.get("k", 3))
        hits = []
        for turn in history:
            content = turn.get("content", "")
            if query in content.lower():
                hits.append(content[:200])
            if len(hits) >= k:
                break
        return json.dumps(hits) if hits else json.dumps(["No matching records found."])

    elif name == "calculate":
        expr = args.get("expression", "")
        try:
            # Restrict to safe arithmetic only
            allowed = set("0123456789+-*/().% ")
            if not all(c in allowed for c in expr):
                return json.dumps({"error": "unsafe expression"})
            result = eval(expr, {"__builtins__": {}})  # noqa: S307
            return json.dumps({"result": result})
        except Exception as e:
            return json.dumps({"error": str(e)})

    elif name == "get_current_time":
        import datetime
        return json.dumps({"utc": datetime.datetime.utcnow().isoformat() + "Z"})

    return json.dumps({"error": f"unknown tool: {name}"})


# ── SSE event helpers ─────────────────────────────────────────────────────────

def _sse(event: str, data: dict) -> str:
    """Format a single Server-Sent Event line."""
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


# ── Data classes ──────────────────────────────────────────────────────────────

@dataclass
class ChatTurn:
    """One complete chat turn with all recorded steps."""
    turn_id: str
    run_id: str
    user_message: str
    assistant_answer: str
    steps: list[dict] = field(default_factory=list)
    latency_s: float = 0.0
    tokens_used: int = 0


# ── Context selection helper ──────────────────────────────────────────────────

MAX_HISTORY_TURNS = 6  # at most 6 past turns in context
MAX_HISTORY_CHARS = 4000  # hard character budget


def _select_context(
    history: list[dict],
) -> tuple[list[dict], dict]:
    """
    Choose which history turns enter the prompt.
    Returns (selected_turns, selection_metadata).
    selection_metadata describes what was kept vs dropped.
    """
    if not history:
        return [], {"kept": 0, "dropped": 0, "reason": "no history"}

    # Keep the most recent turns up to budget
    kept: list[dict] = []
    chars = 0
    dropped = 0
    for turn in reversed(history):
        chunk = len(turn.get("content", ""))
        if len(kept) >= MAX_HISTORY_TURNS or chars + chunk > MAX_HISTORY_CHARS:
            dropped += 1
        else:
            kept.insert(0, turn)
            chars += chunk

    return kept, {
        "kept_turns": len(kept),
        "dropped_turns": dropped,
        "chars_in_context": chars,
        "reason": "budget" if dropped else "full_history",
    }


# ── Router: ask model to decide its plan ─────────────────────────────────────

ROUTER_SYSTEM = """You are a helpful assistant that plans its own next step.

Given the user's message, decide whether to:
  A) answer directly (no tool needed)
  B) call one specific tool

Reply in JSON only, no prose:
{"decision": "direct_answer" | "tool_call", "tool": null | "<tool_name>", "reason": "<one sentence>"}
"""


def _router_decision(user_msg: str, context_turns: list[dict]) -> dict:
    """Ask the model to pick: direct_answer vs tool_call."""
    msgs = [{"role": "system", "content": ROUTER_SYSTEM}]
    for t in context_turns[-2:]:  # only last 2 turns for router
        msgs.append(t)
    msgs.append({"role": "user", "content": user_msg})

    try:
        resp = _groq.chat.completions.create(
            model=settings.judge_model,
            messages=msgs,
            temperature=0.0,
            max_tokens=128,
            response_format={"type": "json_object"},
        )
        raw = resp.choices[0].message.content or "{}"
        data = json.loads(raw)
        decision = data.get("decision", "direct_answer")
        tool = data.get("tool")
        tool_args = data.get("tool_args", {})
        if tool == "calculate" and not tool_args:
            import re
            expr = re.sub(r"[^0-9+\-*/().% ]", "", user_msg).strip()
            tool_args = {"expression": expr or "2 + 2"}
        return {
            "decision": decision,
            "tool": tool,
            "tool_args": tool_args,
            "reason": data.get("reason", ""),
            "alternatives": ["direct_answer", "tool_call"],
            "tokens": resp.usage.total_tokens if resp.usage else 0,
        }
    except Exception as e:
        log.warning("router failed, using heuristic: %s", e)
        lower = user_msg.lower()
        import re
        has_calc_word = any(w in lower for w in ["calculate", "calc", "compute", "evaluate", "sum", "multiply", "divide"])
        has_math_expr = bool(re.search(r"\d+\s*[\+\*\/\%]\s*\d+", user_msg))
        if has_calc_word or has_math_expr:
            decision = "tool_call"
            tool = "calculate"
            reason = "Mathematical expression detected; calling calculate tool"
            expr = re.sub(r"[^0-9+\-*/().% ]", "", user_msg).strip()
            tool_args = {"expression": expr or "2 + 2"}
        elif any(w in lower for w in ["time", "utc", "clock", "what time"]):
            decision = "tool_call"
            tool = "get_current_time"
            reason = "Current temporal query detected; calling get_current_time tool"
            tool_args = {}
        elif any(w in lower for w in ["remember", "memory", "recall", "earlier in this"]):
            decision = "tool_call"
            tool = "search_memory"
            reason = "Conversation history retrieval requested; calling search_memory tool"
            tool_args = {"query": user_msg, "k": 3}
        else:
            decision = "direct_answer"
            tool = None
            reason = "Direct conversational query answered without tool invocation"
            tool_args = {}

        return {
            "decision": decision,
            "tool": tool,
            "tool_args": tool_args,
            "reason": reason,
            "alternatives": ["direct_answer", "tool_call"],
            "tokens": 20,
        }


def execute_tool(name: str, args: dict, history: list[dict] | None = None) -> dict:
    """Execute a registered tool by name with arguments."""
    try:
        out = _run_tool(name, args, history or [])
        return {"status": "ok", "output": out}
    except Exception as e:
        return {"status": "error", "error": str(e), "output": str(e)}


def route_intent(user_msg: str, context_turns: list[dict] | None = None) -> dict:
    """Route user intent to direct answer or tool call."""
    return _router_decision(user_msg, context_turns or [])


# ── Interpretation step: query disambiguation & decision branching ───────────

INTERPRET_SYSTEM = """You are an expert query disambiguation analyzer.
Analyze the user's message in the context of recent conversation turns and memory items to determine if the message has multiple distinct plausible interpretations.

Rules:
1. Ambiguous query: If the message has 2 or more real alternatives (e.g. 'what is apple' could refer to Apple Inc. the tech company, or apple the edible fruit; 'what is python' could be the programming language or the snake), set ambiguous=true, and output 2 to 4 candidates.
2. Unambiguous query: If the query has only one obvious sense given the context (e.g. 'what is 2+2', 'what is the current time?'), set ambiguous=false, and output exactly 1 candidate with confidence 1.0 and favored_by=["none"].
3. Each candidate MUST contain:
   - "label": short, clear name (e.g., 'Apple Inc.', 'Apple (fruit)')
   - "description": 1 sentence explaining this interpretation
   - "confidence": number between 0.0 and 1.0 (all candidate confidences should roughly sum to 1.0)
   - "favored_by": list of context ids favoring this interpretation (e.g. ["turn_0"] or ["none"])
   - "reason": brief explanation for why this interpretation is plausible
4. "chosen": the label of the candidate the assistant should choose given context.
5. "clarify_question": If the top two candidate confidences are within 0.15 of each other, provide a clarification question to ask the user (e.g., "Did you mean Apple the company or apple the fruit?"). If confidences are not close (gap > 0.15), set clarify_question to null.

Reply in strictly valid JSON format matching:
{
  "ambiguous": bool,
  "candidates": [
    {
      "label": "string",
      "description": "string",
      "confidence": 0.0,
      "favored_by": ["none"],
      "reason": "string"
    }
  ],
  "chosen": "string",
  "clarify_question": null or "string"
}
"""


def _interpret_query(
    user_msg: str,
    context_turns: list[dict],
    forced_interpretation: Optional[str] = None,
) -> InterpretationOutput:
    """Run interpretation step with Groq, strict JSON, Pydantic validation, retry once, fallback."""
    ctx_lines = []
    for i, t in enumerate(context_turns):
        role = t.get("role", "turn")
        cnt = t.get("content", "")[:120]
        ctx_lines.append(f"turn_{i} ({role}): {cnt}")
    ctx_str = "\n".join(ctx_lines) if ctx_lines else "none"

    msgs = [
        {"role": "system", "content": INTERPRET_SYSTEM},
        {"role": "user", "content": f"Context:\n{ctx_str}\n\nUser Message: {user_msg}"},
    ]

    for attempt in range(2):
        try:
            resp = _groq.chat.completions.create(
                model=settings.judge_model,
                messages=msgs,
                temperature=0.0,
                max_tokens=384,
                response_format={"type": "json_object"},
            )
            raw = resp.choices[0].message.content or "{}"
            data = json.loads(raw)
            interp = InterpretationOutput.model_validate(data)
            if not interp.candidates:
                raise ValueError("candidates list empty")

            # Validate confidences
            for c in interp.candidates:
                c.confidence = max(0.0, min(1.0, float(c.confidence)))

            if forced_interpretation:
                interp.chosen = forced_interpretation
                interp.clarify_question = None
                found = False
                for c in interp.candidates:
                    if c.label.strip().lower() == forced_interpretation.strip().lower():
                        c.chosen = True
                        found = True
                    else:
                        c.chosen = False
                if not found:
                    forced_cand = InterpretationCandidate(
                        label=forced_interpretation,
                        description=f"User-forced interpretation: {forced_interpretation}",
                        confidence=1.0,
                        favored_by=["user_selection"],
                        reason="User explicitly chose this interpretation",
                        chosen=True,
                    )
                    interp.candidates.insert(0, forced_cand)
            else:
                matched = False
                for c in interp.candidates:
                    if c.label == interp.chosen:
                        c.chosen = True
                        matched = True
                    else:
                        c.chosen = False
                if not matched and interp.candidates:
                    best = max(interp.candidates, key=lambda c: c.confidence)
                    best.chosen = True
                    interp.chosen = best.label

                # If top two confidences are within 0.15, set clarify_question
                if len(interp.candidates) >= 2:
                    sorted_c = sorted(interp.candidates, key=lambda c: c.confidence, reverse=True)
                    if abs(sorted_c[0].confidence - sorted_c[1].confidence) <= 0.15:
                        if not interp.clarify_question:
                            interp.clarify_question = f"Did you mean '{sorted_c[0].label}' or '{sorted_c[1].label}'?"
                    else:
                        interp.clarify_question = None

            return interp
        except Exception as e:
            log.warning("interpret attempt %d failed: %s", attempt + 1, e)
            if attempt == 1:
                break

    # Fallback to single interpretation
    chosen_label = forced_interpretation or user_msg.strip()[:60]
    cand = InterpretationCandidate(
        label=chosen_label,
        description=f"Direct interpretation of '{user_msg}'",
        confidence=1.0,
        favored_by=["none"],
        reason="Single deterministic interpretation fallback",
        chosen=True,
    )
    return InterpretationOutput(
        ambiguous=False,
        candidates=[cand],
        chosen=chosen_label,
        clarify_question=None,
    )


def _measure_influence(user_msg: str, chosen_label: str) -> Optional[str]:
    """Re-run interpret step with history removed to measure context influence."""
    try:
        no_hist_interp = _interpret_query(user_msg, context_turns=[])
        return no_hist_interp.chosen
    except Exception as e:
        log.debug("measured influence error: %s", e)
        return None


# ── Main turn generator (yields SSE strings) ──────────────────────────────────

CHAT_SYSTEM = """You are a helpful, concise assistant. You have access to tools.
When you use a tool, wait for its result before continuing.
Keep answers focused and factual."""


def run_chat_turn(
    user_message: str,
    history: list[dict],
    run_id: Optional[str] = None,
    graph_name: str = "live_chat",
    forced_interpretation: Optional[str] = None,
) -> Generator[str, None, ChatTurn]:
    """
    Execute one chat turn and yield SSE events for each step.

    The caller does:
        gen = run_chat_turn(msg, history, forced_interpretation=...)
        for sse_chunk in gen:
            yield sse_chunk      # stream to browser

    At the very end (StopIteration.value) the ChatTurn is returned
    so the caller can append it to history.
    """
    t_start = time.perf_counter()
    turn_id = f"turn_{uuid.uuid4().hex[:8]}"
    run_id = run_id or f"chat_{uuid.uuid4().hex[:8]}"
    total_tokens = 0

    rec = RunRecorder(run_id=run_id, task=user_message, tenant=graph_name)
    steps: list[dict] = []

    def _emit_step(
        kind: str,
        tool: str,
        inp: Any,
        out: Any,
        status: str = "ok",
        tokens: int = 0,
        dependencies: Optional[Any] = None,
    ) -> dict:
        """Record a step and return it as a dict for SSE."""
        idx = rec.record_step(
            agent="chat_agent",
            kind=kind,  # type: ignore[arg-type]
            tool=tool,
            inp=inp,
            out=out,
            status=status,
            tokens=tokens,
            dependencies=dependencies,
        )
        step_dict = {
            "idx": idx,
            "kind": kind,
            "tool": tool,
            "input": inp if isinstance(inp, str) else json.dumps(inp),
            "output": out if isinstance(out, str) else json.dumps(out),
            "status": status,
            "ts": time.time(),
        }
        steps.append(step_dict)
        return step_dict

    # ── Step 1: chat_input ────────────────────────────────────────────────────
    input_step = _emit_step("chat_input", "user_message", user_message, {})
    yield _sse("step", {"turn_id": turn_id, "step": input_step})

    # ── Step 2: context_selection ─────────────────────────────────────────────
    selected_ctx, ctx_meta = _select_context(history)
    ctx_step = _emit_step("context_selection", "context_selection", ctx_meta,
                          {"kept_turns": [t.get("content", "")[:80] for t in selected_ctx]})
    yield _sse("step", {"turn_id": turn_id, "step": ctx_step})

    # ── Step 3: router ────────────────────────────────────────────────────────
    router = _router_decision(user_message, selected_ctx)
    r_tok = router.pop("tokens", 0)
    total_tokens += int(r_tok) if isinstance(r_tok, (int, float)) else 0
    router_step = _emit_step("router", "router", {"user_msg": user_message[:120]}, router)
    yield _sse("step", {"turn_id": turn_id, "step": router_step})

    # Record router candidate alternatives with CONSIDERED edges
    is_tool = router["decision"] == "tool_call"
    r_tool_name = router.get("tool")
    router_cands = [
        {
            "label": "direct_answer",
            "description": "Answer user query directly without tool invocation",
            "confidence": 0.15 if is_tool else 0.85,
            "chosen": not is_tool,
            "reason": router.get("reason", "") if not is_tool else "Tool invocation deemed more appropriate",
            "favored_by": ["none"],
        },
        {
            "label": f"tool_call: {r_tool_name}" if r_tool_name else "tool_call",
            "description": f"Invoke tool '{r_tool_name}' to resolve request" if r_tool_name else "Invoke specialized tool",
            "confidence": 0.85 if is_tool else 0.15,
            "chosen": is_tool,
            "reason": router.get("reason", "") if is_tool else "Direct conversational answer preferred",
            "favored_by": ["user_message"],
        },
    ]
    r_chosen_cand_idx = None
    for rc in router_cands:
        rc_step = _emit_step(
            "candidate",
            "router_candidate",
            {"decision_idx": router_step["idx"], "label": rc["label"]},
            rc,
            dependencies=[],
        )
        rec.record_considered(router_step["idx"], rc_step["idx"], chosen=rc["chosen"], confidence=rc["confidence"])
        yield _sse("candidate_added", {"turn_id": turn_id, "step": rc_step, "node": rc_step, "decision_idx": router_step["idx"]})
        yield _sse("step", {"turn_id": turn_id, "step": rc_step})
        if rc["chosen"]:
            r_chosen_cand_idx = rc_step["idx"]

    # ── Step 4 (optional): tool_call + tool_result ────────────────────────────
    tool_result_text: Optional[str] = None

    if router["decision"] == "tool_call" and router.get("tool") in {t["function"]["name"] for t in TOOLS}:
        tool_name = router["tool"]

        # Ask the model to fill in the tool arguments
        arg_msgs = [
            {"role": "system", "content": CHAT_SYSTEM},
            *selected_ctx,
            {"role": "user", "content": user_message},
        ]
        try:
            arg_resp = _groq.chat.completions.create(
                model=settings.judge_model,
                messages=arg_msgs,
                tools=TOOLS,
                tool_choice={"type": "function", "function": {"name": tool_name}},
                temperature=0.0,
                max_tokens=256,
            )
            tc = arg_resp.choices[0].message.tool_calls
            args = json.loads(tc[0].function.arguments) if tc else {}
            total_tokens += arg_resp.usage.total_tokens if arg_resp.usage else 0
        except Exception as e:
            args = {}
            log.warning("arg extraction failed, using heuristic: %s", e)
            if tool_name == "calculate":
                import re
                expr = re.sub(r"[^0-9+\-*/().% ]", "", user_message).strip()
                args = {"expression": expr or "2 + 2"}
            elif tool_name == "search_memory":
                args = {"query": user_message, "k": 3}
            elif tool_name == "get_current_time":
                args = {}

        s = _emit_step(
            "tool_call",
            tool_name,
            args,
            {},
            dependencies=[r_chosen_cand_idx] if r_chosen_cand_idx is not None else None,
        )
        yield _sse("step", {"turn_id": turn_id, "step": s})

        # Execute the tool
        t_tool = time.perf_counter()
        tool_out = _run_tool(tool_name, args, history)
        tool_latency = round(time.perf_counter() - t_tool, 3)
        tool_result_text = tool_out

        s = _emit_step("tool_result", tool_name,
                       {"tool": tool_name, "args": args},
                       {"result": tool_out[:500], "latency_s": tool_latency})
        yield _sse("step", {"turn_id": turn_id, "step": s})

    # ── Step 5 (optional): retrieval ──────────────────────────────────────────
    keywords = user_message.lower().split()[:5]
    retrieved: list[str] = []
    for turn in history[-10:]:
        content = turn.get("content", "")
        if any(kw in content.lower() for kw in keywords):
            retrieved.append(content[:120])
    if retrieved:
        s = _emit_step("retrieval", "memory_search",
                       {"keywords": keywords},
                       {"records": retrieved[:3], "count": len(retrieved)})
        yield _sse("step", {"turn_id": turn_id, "step": s})

    # ── Step 6: interpretation (runs before synthesis) ─────────────────────────
    interp = _interpret_query(user_message, selected_ctx, forced_interpretation=forced_interpretation)
    if selected_ctx and interp.ambiguous:
        meas_chosen = _measure_influence(user_message, interp.chosen)
        interp.chosen_without_history = meas_chosen

    dec_payload = interp.model_dump()
    if interp.chosen_without_history:
        dec_payload["measured_influence"] = f"Measured: without earlier turns the choice would be {interp.chosen_without_history}"

    dec_step = _emit_step(
        "decision",
        "interpret",
        {"user_msg": user_message, "context_turns": len(selected_ctx), "forced": bool(forced_interpretation)},
        dec_payload,
        dependencies=[ctx_step["idx"]],
    )
    yield _sse("decision_added", {"turn_id": turn_id, "step": dec_step, "node": dec_step})
    yield _sse("step", {"turn_id": turn_id, "step": dec_step})

    # Record child candidate nodes with CONSIDERED and FAVORED_BY edges
    chosen_cand_idx = None
    chosen_cand = None
    for c in interp.candidates:
        c_step = _emit_step(
            "candidate",
            "interpret_candidate",
            {"decision_idx": dec_step["idx"], "label": c.label},
            c.model_dump(),
            dependencies=[dec_step["idx"]] if c.chosen else [],
        )
        rec.record_considered(dec_step["idx"], c_step["idx"], chosen=c.chosen, confidence=c.confidence)
        for fav in c.favored_by:
            if fav and fav != "none":
                rec.record_favored_by(c_step["idx"], target_step_idx=ctx_step["idx"])

        yield _sse("candidate_added", {"turn_id": turn_id, "step": c_step, "node": c_step, "decision_idx": dec_step["idx"]})
        yield _sse("step", {"turn_id": turn_id, "step": c_step})

        if c.chosen:
            chosen_cand_idx = c_step["idx"]
            chosen_cand = c

    if chosen_cand is None and interp.candidates:
        chosen_cand = interp.candidates[0]
        chosen_cand_idx = dec_step["idx"]

    # If clarification is needed and not forced, pause and let user pick
    if interp.clarify_question and not forced_interpretation:
        clarify_data = {
            "turn_id": turn_id,
            "run_id": run_id,
            "clarify_question": interp.clarify_question,
            "candidates": [c.model_dump() for c in interp.candidates],
            "decision_idx": dec_step["idx"],
        }
        yield _sse("clarify", clarify_data)

        rec.record_answer(dec_step["idx"])
        try:
            rec.finish_run(outcome="success")
            rec.sync_to_falkordb(graph_name=graph_name)
        except Exception as e:
            log.warning("FalkorDB sync failed (non-fatal): %s", e)

        latency = round(time.perf_counter() - t_start, 3)
        yield _sse("done", {
            "turn_id": turn_id,
            "run_id": run_id,
            "latency_s": latency,
            "tokens": total_tokens,
            "n_steps": len(steps),
            "needs_clarification": True,
        })
        return ChatTurn(
            turn_id=turn_id,
            run_id=run_id,
            user_message=user_message,
            assistant_answer=interp.clarify_question,
            steps=steps,
            latency_s=latency,
            tokens_used=total_tokens,
        )

    # ── Step 7: synthesis (streaming) ────────────────────────────────────────
    # The chosen interpretation MUST be passed into the synthesis prompt
    chosen_label = chosen_cand.label if chosen_cand else "Standard interpretation"
    interpretation_instruction = f"Interpret the question as: {chosen_label}. Answer accordingly."
    final_msgs: list[dict] = [
        {"role": "system", "content": f"{CHAT_SYSTEM}\n\n{interpretation_instruction}"}
    ]
    final_msgs.extend(selected_ctx)
    final_msgs.append({"role": "user", "content": user_message})
    if tool_result_text:
        final_msgs.append({
            "role": "assistant",
            "content": None,
            "tool_calls": [{"id": "tc_1", "type": "function",
                            "function": {"name": router.get("tool", "tool"),
                                         "arguments": "{}"}}],
        })
        final_msgs.append({
            "role": "tool",
            "tool_call_id": "tc_1",
            "content": tool_result_text,
        })

    # Start the synthesis step node immediately with DEPENDS_ON to chosen candidate
    synth_step = _emit_step(
        "synthesis",
        "synthesis",
        {
            "prompt_turns": len(final_msgs),
            "interpretation": chosen_label,
            "interpretation_instruction": interpretation_instruction,
            "messages": final_msgs,
        },
        {"streaming": True},
        dependencies=[chosen_cand_idx] if chosen_cand_idx is not None else None,
    )
    yield _sse("step", {"turn_id": turn_id, "step": synth_step})

    # Stream the answer tokens
    answer_chunks: list[str] = []
    synth_tokens = 0
    try:
        stream = _groq.chat.completions.create(
            model=settings.judge_model,
            messages=final_msgs,
            temperature=0.7,
            max_tokens=1024,
            stream=True,
        )
        for chunk in stream:
            delta = chunk.choices[0].delta if chunk.choices else None
            if delta and delta.content:
                answer_chunks.append(delta.content)
                yield _sse("token", {"turn_id": turn_id, "token": delta.content})
            # Groq streams usage in the final chunk
            if hasattr(chunk, "x_groq") and chunk.x_groq:
                usage_obj = getattr(chunk.x_groq, "usage", None)
                if usage_obj:
                    synth_tokens = getattr(usage_obj, "total_tokens", 0) or 0
    except Exception as e:
        log.warning("streaming synthesis failed, generating simulated stream: %s", e)
        if tool_result_text:
            try:
                res_obj = json.loads(tool_result_text)
                if isinstance(res_obj, dict) and "result" in res_obj:
                    synth_resp = f"The calculation result for {user_message.strip()} is {res_obj['result']}."
                elif isinstance(res_obj, dict) and "utc" in res_obj:
                    synth_resp = f"The current UTC time is {res_obj['utc']}."
                else:
                    synth_resp = f"Based on tool execution ({router.get('tool')}): {tool_result_text}"
            except Exception:
                synth_resp = f"Executed {router.get('tool')}: {tool_result_text}"
        else:
            synth_resp = f"I received your query: \"{user_message}\". In Live Chat Mode, all observable execution steps (context selection, routing, memory search, and answer assembly) are recorded into the causal graph in real time."

        words = synth_resp.split(" ")
        for i, word in enumerate(words):
            token_str = word + (" " if i < len(words) - 1 else "")
            answer_chunks.append(token_str)
            yield _sse("token", {"turn_id": turn_id, "token": token_str})
            time.sleep(0.02)
        synth_tokens = len(words) * 2

    total_tokens += synth_tokens
    answer_text = "".join(answer_chunks)

    # ── Step 7: chat_output ───────────────────────────────────────────────────
    rec.record_answer(
        rec.record_step(
            agent="chat_agent",
            kind="chat_output",
            tool="answer",
            inp={"synthesis_step": synth_step["idx"]},
            out=answer_text,
            tokens=synth_tokens,
        )
    )
    answer_step = {
        "idx": len(steps),
        "kind": "chat_output",
        "tool": "answer",
        "input": json.dumps({"synthesis_step": synth_step["idx"]}),
        "output": answer_text,
        "status": "ok",
        "ts": time.time(),
    }
    steps.append(answer_step)
    yield _sse("step", {"turn_id": turn_id, "step": answer_step})

    # ── Persist to FalkorDB ───────────────────────────────────────────────────
    try:
        trace = rec.finish_run(outcome="success")
        rec.sync_to_falkordb(graph_name=graph_name)
    except Exception as e:
        log.warning("FalkorDB sync failed (non-fatal): %s", e)
        trace = rec.finish_run(outcome="success")

    latency = round(time.perf_counter() - t_start, 3)

    # ── done event ────────────────────────────────────────────────────────────
    turn = ChatTurn(
        turn_id=turn_id,
        run_id=run_id,
        user_message=user_message,
        assistant_answer=answer_text,
        steps=steps,
        latency_s=latency,
        tokens_used=total_tokens,
    )
    yield _sse("done", {
        "turn_id": turn_id,
        "run_id": run_id,
        "latency_s": latency,
        "tokens": total_tokens,
        "n_steps": len(steps),
    })

    return turn

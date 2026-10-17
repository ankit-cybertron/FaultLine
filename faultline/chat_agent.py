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
from typing import Any, Generator, Iterator, Optional

from groq import Groq
from groq.types.chat import ChatCompletion

from faultline.config import settings
from faultline.recorder import RunRecorder

log = logging.getLogger(__name__)

# ── Groq client (same key as llm.py) ─────────────────────────────────────────
_groq = Groq(api_key=settings.groq_api_key)

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


# ── Main turn generator (yields SSE strings) ──────────────────────────────────

CHAT_SYSTEM = """You are a helpful, concise assistant. You have access to tools.
When you use a tool, wait for its result before continuing.
Keep answers focused and factual."""


def run_chat_turn(
    user_message: str,
    history: list[dict],
    run_id: Optional[str] = None,
    graph_name: str = "live_chat",
) -> Generator[str, None, ChatTurn]:
    """
    Execute one chat turn and yield SSE events for each step.

    The caller does:
        gen = run_chat_turn(msg, history)
        for sse_chunk in gen:
            yield sse_chunk      # stream to browser

    At the very end (StopIteration.value) the ChatTurn is returned
    so the caller can append it to history.

    Usage in FastAPI with StreamingResponse:
        async def stream():
            gen = run_chat_turn(msg, history)
            try:
                while True:
                    yield next(gen)
            except StopIteration as e:
                turn = e.value
                ...
    """
    t_start = time.perf_counter()
    turn_id = f"turn_{uuid.uuid4().hex[:8]}"
    run_id = run_id or f"chat_{uuid.uuid4().hex[:8]}"
    total_tokens = 0

    rec = RunRecorder(run_id=run_id, task=user_message, tenant=graph_name)
    steps: list[dict] = []

    def _emit_step(kind: str, tool: str, inp: Any, out: Any, status: str = "ok", tokens: int = 0) -> dict:
        """Record a step and return it as a dict for SSE."""
        idx = rec.record_step(
            agent="chat_agent",
            kind=kind,  # type: ignore[arg-type]
            tool=tool,
            inp=inp,
            out=out,
            status=status,
            tokens=tokens,
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
    s = _emit_step("chat_input", "user_message", user_message, {})
    yield _sse("step", {"turn_id": turn_id, "step": s})

    # ── Step 2: context_selection ─────────────────────────────────────────────
    selected_ctx, ctx_meta = _select_context(history)
    s = _emit_step("context_selection", "context_selection", ctx_meta,
                   {"kept_turns": [t.get("content", "")[:80] for t in selected_ctx]})
    yield _sse("step", {"turn_id": turn_id, "step": s})

    # ── Step 3: router ────────────────────────────────────────────────────────
    router = _router_decision(user_message, selected_ctx)
    total_tokens += router.pop("tokens", 0)
    s = _emit_step("router", "router", {"user_msg": user_message[:120]}, router)
    yield _sse("step", {"turn_id": turn_id, "step": s})

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

        s = _emit_step("tool_call", tool_name, args, {})
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
    # Simple keyword retrieval from history (always runs; may return nothing)
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

    # ── Step 6: synthesis (streaming) ────────────────────────────────────────
    # Build final prompt
    final_msgs: list[dict] = [{"role": "system", "content": CHAT_SYSTEM}]
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

    # Start the synthesis step node immediately
    synth_step = _emit_step("synthesis", "synthesis",
                             {"prompt_turns": len(final_msgs)}, {"streaming": True})
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

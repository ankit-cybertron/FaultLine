"""
judge.py — Per-step correctness judgement.

The judge sees only a single step in isolation: its inputs, its output,
and a one-sentence description of what the step was supposed to do.
It returns {wrong: bool, why: str, confidence: float}.

This isolation is the whole point. A flat-log reader sees the entire trace and
gets confused by late-stage symptoms (a verifier saying "result looks fine"
300 tokens after the actual mistake). The judge doesn't see any of that.

All calls go through llm.complete_json and are cached on disk by (step, input_hash).
"""

from __future__ import annotations

import json
import logging
from typing import Optional

from faultline import llm
from faultline.config import settings
from faultline.ir import JudgeVerdict, Step

log = logging.getLogger(__name__)

# The judge prompt. Keep it tight: the model needs to answer one binary question.
# We give it the step context and nothing else — no surrounding trace, no outcome.
_SYSTEM = """\
You are a step auditor for an AI agent system. Your only job is to decide
whether a single step's output is CORRECT given its inputs.

You do NOT have access to the rest of the agent run. Judge only on what is here.
If you are unsure, lean toward wrong=false (don't blame a step you can't verify).

Respond with valid JSON only, no markdown:
{"wrong": <bool>, "why": "<one sentence; empty string if wrong=false>", "confidence": <0.0-1.0>}
"""

def _build_prompt(step: Step, task_context: str = "") -> list[dict]:
    """
    Build the judge prompt for one step.
    task_context: short description of the overall task (helps judge calibrate).
    """
    step_block = {
        "step_idx": step.idx,
        "agent": step.agent,
        "kind": step.kind,
        "tool": step.tool or "(none)",
        "input": step.input_dict(),
        "output": step.output_dict(),
        "status": step.status,
    }
    user_msg = (
        f"Task context: {task_context}\n\n"
        if task_context
        else ""
    ) + f"Step to audit:\n{json.dumps(step_block, indent=2)}\n\nIs this step's output correct?"

    return [
        {"role": "system", "content": _SYSTEM},
        {"role": "user", "content": user_msg},
    ]


def judge_step(
    step: Step,
    task_context: str = "",
    model: Optional[str] = None,
) -> tuple[JudgeVerdict, int]:
    """
    Judge one step. Returns (verdict, tokens_used).
    Result is cached by step.input_hash so repeated evaluations across
    ablation runs don't burn rate-limit quota.
    """
    messages = _build_prompt(step, task_context)
    raw, tokens = llm.complete_json(
        messages,
        model=model or settings.judge_model,
        temperature=0.0,
        max_tokens=256,
    )

    if raw.get("parse_error"):
        log.warning("judge parse error on step %d run %s", step.idx, step.run_id)
        verdict = JudgeVerdict(
            run_id=step.run_id,
            idx=step.idx,
            wrong=False,
            why="judge could not parse the step output",
            confidence=0.0,
        )
        return verdict, tokens

    verdict = JudgeVerdict(
        run_id=step.run_id,
        idx=step.idx,
        wrong=bool(raw.get("wrong", False)),
        why=str(raw.get("why", "")),
        confidence=float(raw.get("confidence", 1.0)),
    )
    log.debug("judge step=%d wrong=%s conf=%.2f", step.idx, verdict.wrong, verdict.confidence)
    return verdict, tokens


def judge_steps_bulk(
    steps: list[Step],
    task_context: str = "",
    model: Optional[str] = None,
) -> tuple[list[JudgeVerdict], int]:
    """
    Judge a list of steps, accumulating total token cost.
    Steps are judged in order (topological, earliest first, set by the caller).
    We stop early once we've found the origin: a step whose output is wrong
    but all its already-judged parents were correct.
    Early stopping is NOT done here — the investigator decides when to stop.
    """
    verdicts = []
    total_tokens = 0
    for step in steps:
        v, tokens = judge_step(step, task_context, model)
        verdicts.append(v)
        total_tokens += tokens
    return verdicts, total_tokens

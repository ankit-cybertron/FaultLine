"""
whowhen.py — Adapter for the Who&When agent benchmark.

Who&When is a research benchmark for multi-agent task completion on calendar
and scheduling tasks. Each trace includes named agents (scheduler, verifier,
executor) with explicit handoff steps.

Expected format: a JSONL where each line is one run with this schema:
{
  "id": "...",
  "task": "schedule a meeting for Alice and Bob on Tuesday",
  "outcome": "success" | "failure",
  "root_cause": <int step index> | null,
  "steps": [
    {
      "idx": 0,
      "agent": "scheduler",
      "action": "tool_call",
      "tool": "check_calendar",
      "args": {...},
      "result": {...},
      "error": null | "...",
      "handoff_to": null | "verifier",
      "timestamp": 1234567890.0
    },
    ...
  ]
}

The "handoff_to" field tells us when one agent passes control to another —
we model those as HANDOFF_FROM edges in the IR.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Iterator

from faultline.ir import DependsOnEdge, Step, Trace

log = logging.getLogger(__name__)


def _step_from_ww(run_id: str, raw: dict) -> Step:
    idx = int(raw.get("idx", 0))
    has_error = bool(raw.get("error"))
    status = "error" if has_error else "ok"

    # args → input, result/error → output
    args = raw.get("args") or raw.get("input") or {}
    result = raw.get("result") or {}
    if has_error:
        result = {"error_type": "step_error", "error_msg": raw["error"], **result}

    action = raw.get("action") or "tool_call"
    kind_map = {
        "tool_call": "tool_call",
        "llm": "llm_response",
        "handoff": "handoff",
        "observe": "observation",
    }

    return Step(
        run_id=run_id,
        idx=idx,
        id=str(raw.get("id") or raw.get("step_id") or idx),
        agent=raw.get("agent") or "agent",
        kind=kind_map.get(action, "tool_call"),  # type: ignore[arg-type]
        tool=raw.get("tool") or None,
        input=json.dumps(args),
        output=json.dumps(result),
        status=status,  # type: ignore[arg-type]
        ts=float(raw.get("timestamp") or 0.0),
        tokens=int(raw.get("tokens") or 0),
    )


def _extract_edges(steps: list[Step], raw_steps: list[dict]) -> list[DependsOnEdge]:
    """
    Build DEPENDS_ON edges from the Who&When trace.
    Two sources:
      1. Sequential dependency: each step implicitly depends on the previous one
         in the same agent's thread (agent context carries forward).
         These get conf=0.8 (inferred, not explicit).
      2. Handoff: step[i].handoff_to = agent_name means step[i+1] (the first step
         of that agent after the handoff) depends on step[i].
         These get kind="native", conf=1.0.
    """
    edges: list[DependsOnEdge] = []

    # Build sequential per-agent dependencies
    agent_last: dict[str, int] = {}
    for step in steps:
        prev = agent_last.get(step.agent)
        if prev is not None and prev != step.idx:
            edges.append(DependsOnEdge(from_idx=step.idx, to_idx=prev, kind="inferred", conf=0.8))
        agent_last[step.agent] = step.idx

    # Build handoff edges
    for i, raw in enumerate(raw_steps):
        handoff_to = raw.get("handoff_to")
        if not handoff_to:
            continue
        # Find the first subsequent step belonging to handoff_to
        current_idx = raw.get("idx", i)
        for later in steps:
            if later.idx > current_idx and later.agent == handoff_to:
                edges.append(
                    DependsOnEdge(from_idx=later.idx, to_idx=current_idx, kind="native", conf=1.0)
                )
                break

    # Deduplicate
    seen = set()
    deduped = []
    for e in edges:
        key = (e.from_idx, e.to_idx)
        if key not in seen:
            seen.add(key)
            deduped.append(e)

    return deduped


def _parse_run(data: dict) -> Trace:
    run_id = str(data.get("id") or data.get("run_id") or "ww_unknown")
    task = data.get("task") or ""
    outcome_raw = data.get("outcome") or "success"
    outcome = outcome_raw if outcome_raw in ("success", "failure", "error") else "error"

    raw_steps = data.get("steps") or []
    steps = [_step_from_ww(run_id, r) for r in raw_steps]
    edges = _extract_edges(steps, raw_steps)

    failure_idx = next((s.idx for s in steps if s.status == "error"), None)
    root_cause_idx = data.get("root_cause")

    return Trace(
        run_id=run_id,
        task=task,
        outcome=outcome,  # type: ignore[arg-type]
        source="whowhen",
        steps=steps,
        edges=edges,
        failure_idx=failure_idx,
        root_cause_idx=root_cause_idx,
    )


def load_jsonl(path: Path) -> Iterator[Trace]:
    """Load a Who&When JSONL file, one trace per line."""
    with open(path) as f:
        for i, line in enumerate(f):
            line = line.strip()
            if not line:
                continue
            try:
                yield _parse_run(json.loads(line))
            except Exception as e:
                log.warning("who&when parse error line %d: %s", i, e)


def load_file(path: Path) -> Trace:
    """Load a single Who&When JSON file (one trace)."""
    with open(path) as f:
        return _parse_run(json.load(f))


whowhen_to_trace = _parse_run


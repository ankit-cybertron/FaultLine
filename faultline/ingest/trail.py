"""
trail.py — Adapter for the TRAIL agent trajectory dataset.

TRAIL (Trajectories from Real-world Agent Interactions with LLMs) is a
collection of agent runs in JSON format. Each file is one run.

Expected schema (verify with Task 1.2 in the execution plan):
{
  "run_id": "...",
  "task": "...",
  "outcome": "success|failure|error",
  "spans": [
    {
      "span_id": "...",
      "parent_span_id": "...|null",
      "agent": "...",
      "action": "tool_call|llm_response|handoff|observation",
      "tool": "...|null",
      "input": {...},
      "output": {...},
      "status": "ok|error",
      "timestamp": 1234567890.0,
      "token_count": 120
    },
    ...
  ]
}

If the actual TRAIL schema differs, update the field mappings in _span_to_step().
The rest of the system only sees the Trace IR.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Iterator

from faultline.ir import DependsOnEdge, Step, Trace

log = logging.getLogger(__name__)


def _span_to_step(run_id: str, idx: int, span: dict) -> Step:
    """Map one TRAIL span dict to a faultline Step."""

    # Normalize action/kind field — TRAIL may use "action" or "type"
    kind_raw = span.get("action") or span.get("type") or "tool_call"
    kind_map = {
        "tool_call": "tool_call",
        "llm": "llm_response",
        "llm_response": "llm_response",
        "handoff": "handoff",
        "observation": "observation",
        "error": "error",
    }
    kind = kind_map.get(kind_raw, "tool_call")

    return Step(
        run_id=run_id,
        idx=idx,
        id=span.get("span_id") or str(idx),
        agent=span.get("agent") or span.get("role") or "agent",
        kind=kind,  # type: ignore[arg-type]
        tool=span.get("tool") or None,
        input=json.dumps(span.get("input", {})),
        output=json.dumps(span.get("output", {})),
        status="error" if span.get("status") == "error" else "ok",
        ts=float(span.get("timestamp") or span.get("ts") or 0.0),
        tokens=int(span.get("token_count") or span.get("tokens") or 0),
    )


def _infer_native_edges(spans: list[dict]) -> list[dict[str, str | int | float]]:
    """
    Extract native DEPENDS_ON edges from span parent/child relationships.
    span.parent_span_id → consumer span depends on producer span.
    Returns list of {from_idx, to_idx} dicts (idx is position in list).
    """
    span_id_to_idx = {span.get("span_id", str(i)): i for i, span in enumerate(spans)}
    edges = []
    for idx, span in enumerate(spans):
        parent_id = span.get("parent_span_id")
        if parent_id and parent_id in span_id_to_idx:
            parent_idx = span_id_to_idx[parent_id]
            # This span (consumer, idx) depends on parent span (producer, parent_idx)
            edges.append({"from_idx": idx, "to_idx": parent_idx})
    return edges


def trail_to_trace(data: dict, run_id: str | None = None) -> Trace:
    """Convert a TRAIL JSON dictionary into Trace IR."""
    spans = data.get("spans") or data.get("steps") or []
    effective_run_id = str(data.get("run_id") or run_id or "trail_run")
    task = data.get("task") or data.get("goal") or "unknown task"
    outcome_raw = data.get("outcome") or data.get("result") or "success"
    outcome = outcome_raw if outcome_raw in ("success", "failure", "error") else "error"

    steps = [_span_to_step(effective_run_id, i, span) for i, span in enumerate(spans)]

    # Native edges from span hierarchy
    raw_edges = _infer_native_edges(spans)
    edges = [
        DependsOnEdge(from_idx=e["from_idx"], to_idx=e["to_idx"], kind="native", conf=1.0)
        for e in raw_edges
        if e["from_idx"] != e["to_idx"]
    ]

    # Ground-truth root cause if labeled
    root_cause_idx = data.get("root_cause_step") or data.get("root_cause_idx")
    failure_idx = next((s.idx for s in steps if s.status == "error"), None)

    trace = Trace(
        run_id=effective_run_id,
        task=task,
        outcome=outcome,  # type: ignore[arg-type]
        source="trail",
        steps=steps,
        edges=edges,
        failure_idx=failure_idx,
        root_cause_idx=root_cause_idx,
    )
    log.debug("loaded trail %s steps=%d native_edges=%d", effective_run_id, trace.n_steps, trace.n_native_edges)
    return trace


def load_file(path: Path) -> Trace:
    """Load a single TRAIL JSON file into a Trace."""
    with open(path) as f:
        data = json.load(f)
    return trail_to_trace(data, run_id=path.stem)



def load_directory(directory: Path) -> Iterator[Trace]:
    """Yield Trace objects for every JSON file in a directory."""
    files = sorted(directory.glob("*.json"))
    log.info("loading %d TRAIL traces from %s", len(files), directory)
    for path in files:
        try:
            yield load_file(path)
        except Exception as e:
            log.warning("failed to load %s: %s", path.name, e)


def load_jsonl(path: Path) -> Iterator[Trace]:
    """Load a TRAIL dataset packed as JSONL (one trace per line)."""
    with open(path) as f:
        for i, line in enumerate(f):
            line = line.strip()
            if not line:
                continue
            try:
                data = json.loads(line)
                # Write to a temporary dict so load_file logic is reused
                spans = data.get("spans") or data.get("steps") or []
                run_id = data.get("run_id") or f"trail_{i:04d}"
                # Yield by temporarily writing and re-reading is wasteful;
                # inline the parse instead
                yield _parse_dict(data, run_id)
            except Exception as e:
                log.warning("failed to parse JSONL line %d: %s", i, e)


def _parse_dict(data: dict, run_id: str) -> Trace:
    spans = data.get("spans") or data.get("steps") or []
    task = data.get("task") or data.get("goal") or "unknown task"
    outcome_raw = data.get("outcome") or "success"
    outcome = outcome_raw if outcome_raw in ("success", "failure", "error") else "error"

    steps = [_span_to_step(run_id, i, span) for i, span in enumerate(spans)]
    raw_edges = _infer_native_edges(spans)
    edges = [
        DependsOnEdge(from_idx=e["from_idx"], to_idx=e["to_idx"], kind="native", conf=1.0)
        for e in raw_edges
        if e["from_idx"] != e["to_idx"]
    ]
    failure_idx = next((s.idx for s in steps if s.status == "error"), None)
    return Trace(
        run_id=run_id,
        task=task,
        outcome=outcome,  # type: ignore[arg-type]
        source="trail",
        steps=steps,
        edges=edges,
        failure_idx=failure_idx,
        root_cause_idx=data.get("root_cause_step"),
    )

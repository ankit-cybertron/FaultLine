"""
otel.py — Ingest agent traces exported via OpenTelemetry.

The demo agent in demo_agent/agent.py exports spans via the OTLP exporter.
This adapter reads those spans (from a local OTLP collector or a JSON export)
and converts them to the Trace IR.

OTel span → Step mapping:
  span.name            → Step.agent + kind (we encode "agent/kind" in span.name)
  span.attributes      → Step.tool, input, output, status
  span.parent_span_id  → native DEPENDS_ON edge to parent step

To capture spans locally without a collector:
  demo_agent/agent.py writes spans to data/otel/<run_id>.json
  (list of OTel JSON span objects, same format as OTLP/JSON export)
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Iterator

from faultline.ir import DependsOnEdge, Step, Trace

log = logging.getLogger(__name__)

# OTel attribute keys we use — must match what demo_agent emits
_ATTR_AGENT = "faultline.agent"
_ATTR_KIND = "faultline.kind"
_ATTR_TOOL = "faultline.tool"
_ATTR_INPUT = "faultline.input"
_ATTR_OUTPUT = "faultline.output"
_ATTR_STATUS = "faultline.status"
_ATTR_TOKENS = "faultline.tokens"
_ATTR_TASK = "faultline.task"
_ATTR_OUTCOME = "faultline.outcome"


def _attrs(span: dict) -> dict:
    """Flatten OTel attributes list [{"key": k, "value": {...}}] to a plain dict."""
    raw = span.get("attributes") or []
    if isinstance(raw, dict):
        return raw  # already flat (some exporters)
    result = {}
    for attr in raw:
        key = attr.get("key", "")
        val_obj = attr.get("value", {})
        # OTel value is a oneOf: {stringValue, intValue, boolValue, ...}
        if "stringValue" in val_obj:
            result[key] = val_obj["stringValue"]
        elif "intValue" in val_obj:
            result[key] = int(val_obj["intValue"])
        elif "boolValue" in val_obj:
            result[key] = val_obj["boolValue"]
        elif "doubleValue" in val_obj:
            result[key] = float(val_obj["doubleValue"])
    return result


def _otel_span_to_step(run_id: str, idx: int, span: dict) -> Step:
    attrs = _attrs(span)

    # Parse timestamps from OTel nanoseconds
    ts_ns = span.get("startTimeUnixNano") or span.get("start_time_unix_nano") or "0"
    ts = int(ts_ns) / 1e9

    status_code = span.get("status", {}).get("code", "STATUS_CODE_OK")
    status = "error" if status_code in ("STATUS_CODE_ERROR", 2) else "ok"

    return Step(
        run_id=run_id,
        idx=idx,
        agent=attrs.get(_ATTR_AGENT) or "agent",
        kind=attrs.get(_ATTR_KIND) or "tool_call",  # type: ignore[arg-type]
        tool=attrs.get(_ATTR_TOOL) or None,
        input=attrs.get(_ATTR_INPUT) or "{}",
        output=attrs.get(_ATTR_OUTPUT) or "{}",
        status=status,  # type: ignore[arg-type]
        ts=ts,
        tokens=int(attrs.get(_ATTR_TOKENS) or 0),
    )


def otel_to_trace(data: list[dict] | dict, run_id: str = "run") -> Trace:
    """
    Convert an in-memory OTel JSON span list or OTLP envelope into Trace IR.
    """
    if isinstance(data, dict) and "resourceSpans" in data:
        spans = []
        for rs in data["resourceSpans"]:
            for ss in rs.get("scopeSpans", []):
                spans.extend(ss.get("spans", []))
    elif isinstance(data, list):
        spans = list(data)
    elif isinstance(data, dict) and "spans" in data:
        spans = list(data["spans"])
    else:
        log.warning("unknown OTel format; trying as empty")
        spans = []

    if not spans:
        raise ValueError("no spans found in OTel data")

    # Sort by start time
    spans.sort(key=lambda s: int(s.get("startTimeUnixNano") or s.get("start_time_unix_nano") or 0))

    # Extract run metadata from the first span's attributes
    first_attrs = _attrs(spans[0])
    task = first_attrs.get(_ATTR_TASK) or "unknown"
    outcome_raw = first_attrs.get(_ATTR_OUTCOME) or "success"
    outcome = outcome_raw if outcome_raw in ("success", "failure", "error") else "error"

    steps = [_otel_span_to_step(run_id, i, s) for i, s in enumerate(spans)]

    # Native edges from OTel parent_span_id
    span_id_to_idx = {}
    for i, span in enumerate(spans):
        sid = span.get("spanId") or span.get("span_id")
        if sid:
            span_id_to_idx[sid] = i

    edges = []
    for i, span in enumerate(spans):
        parent_id = span.get("parentSpanId") or span.get("parent_span_id")
        if parent_id and parent_id in span_id_to_idx:
            parent_idx = span_id_to_idx[parent_id]
            if parent_idx != i:
                edges.append(DependsOnEdge(from_idx=i, to_idx=parent_idx, kind="native", conf=1.0))

    failure_idx = next((s.idx for s in steps if s.status == "error"), None)

    return Trace(
        run_id=run_id,
        task=task,
        outcome=outcome,  # type: ignore[arg-type]
        source="otel",
        steps=steps,
        edges=edges,
        failure_idx=failure_idx,
    )


def load_otel_file(path: Path) -> Trace:
    """
    Load an OTel JSON export. Expects a list of span objects at the top level,
    or the standard OTLP/JSON envelope with resourceSpans.
    """
    with open(path) as f:
        data = json.load(f)
    return otel_to_trace(data, run_id=path.stem)



def load_directory(directory: Path) -> Iterator[Trace]:
    for path in sorted(directory.glob("*.json")):
        try:
            yield load_otel_file(path)
        except Exception as e:
            log.warning("failed to load OTel file %s: %s", path, e)

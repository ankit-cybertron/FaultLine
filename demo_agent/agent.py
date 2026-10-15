"""
demo_agent/agent.py — A realistic multi-agent data pipeline that fault-injects
on 40% of runs so FaultLine has something to investigate.

Task: "Summarise Q3 sales figures for the APAC region from the data warehouse."

Agents in the pipeline:
  planner     → decides which tables/filters to use
  fetcher     → calls the data warehouse tool
  transformer → applies currency conversion + aggregation
  verifier    → checks row counts and sum consistency
  reporter    → writes the final markdown summary

Faults (chosen randomly each run, injected via faults.py):
  - wrong_table: fetcher uses the wrong table name → empty result
  - stale_cache: fetcher returns cached data from wrong quarter
  - bad_filter: transformer applies wrong date filter → over-counts
  - skip_currency: transformer skips conversion → USD/AUD mix
  - verifier_blind: verifier passes a bad result (hallucinated "ok")
  - no_fault: clean run (success baseline)

All spans are emitted as OTel-compatible JSON and written to
data/otel/<run_id>.json for FaultLine ingestion.

The task is deterministic per fault type so replay is feasible.
"""

from __future__ import annotations

import json
import logging
import time
import uuid
from pathlib import Path
from typing import Optional

from opentelemetry import trace as otel_trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

from demo_agent.faults import Fault, get_fault, inject_fault, pick_fault
from faultline.ir import Step, Trace
from faultline.recorder import RunRecorder, TrackedValue

log = logging.getLogger(__name__)

# ──────────────────────────────────────────────────────────────
# Simulated tool definitions
# Normally these would call real APIs; we simulate deterministically.
# ──────────────────────────────────────────────────────────────

_WAREHOUSE = {
    "sales_q3_apac": [
        {"country": "AU", "revenue_local": 120_000, "currency": "AUD"},
        {"country": "JP", "revenue_local": 8_500_000, "currency": "JPY"},
        {"country": "SG", "revenue_local": 95_000, "currency": "SGD"},
    ],
    "sales_q2_apac": [  # stale table
        {"country": "AU", "revenue_local": 90_000, "currency": "AUD"},
        {"country": "JP", "revenue_local": 7_200_000, "currency": "JPY"},
        {"country": "SG", "revenue_local": 70_000, "currency": "SGD"},
    ],
    "sales_q3_emea": [],  # wrong region table
}

_FX_RATES = {"AUD": 0.66, "JPY": 0.0067, "SGD": 0.74}  # to USD


def _tool_query_warehouse(table: str, filters: dict) -> dict:
    rows = _WAREHOUSE.get(table, [])
    if not rows:
        return {"rows": [], "error": f"table '{table}' not found or empty"}
    return {"rows": rows, "row_count": len(rows)}


def _tool_convert_currency(rows: list[dict], skip: bool = False) -> dict:
    if skip:
        return {"rows": rows, "note": "currency conversion skipped"}
    converted = []
    for row in rows:
        rate = _FX_RATES.get(row["currency"], 1.0)
        converted.append({
            "country": row["country"],
            "revenue_usd": round(row["revenue_local"] * rate, 2),
        })
    return {"rows": converted}


def _tool_aggregate(rows: list[dict], date_filter: Optional[str] = None) -> dict:
    if date_filter == "bad":
        # Bad filter doubles the sum (simulates off-by-one on date range)
        total = sum(r.get("revenue_usd", r.get("revenue_local", 0)) for r in rows) * 2
    else:
        total = sum(r.get("revenue_usd", r.get("revenue_local", 0)) for r in rows)
    return {"total_usd": round(total, 2), "row_count": len(rows)}


def _tool_verify(aggregate: dict, raw_rows: list[dict], table: str = "", skip_fx: bool = False) -> dict:
    expected_count = len(raw_rows)
    actual_count = aggregate.get("row_count", 0)
    count_ok = expected_count == actual_count
    quarter_ok = "q2" not in table.lower()
    fx_ok = not skip_fx
    ok = count_ok and quarter_ok and fx_ok
    error_msg = ""
    if not quarter_ok:
        error_msg = f"quarter mismatch: queried table '{table}' for a Q3 report"
    elif not fx_ok:
        error_msg = "currency mismatch: raw rows contain unconverted currencies"
    elif not count_ok:
        error_msg = f"row count mismatch: expected {expected_count}, got {actual_count}"
    return {"ok": ok, "expected_count": expected_count, "actual_count": actual_count, "error_msg": error_msg}



# ──────────────────────────────────────────────────────────────
# OTel setup
# ──────────────────────────────────────────────────────────────

def _make_tracer():
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    tracer = provider.get_tracer("demo_agent")
    return tracer, exporter, provider


# ──────────────────────────────────────────────────────────────
# Agent pipeline
# ──────────────────────────────────────────────────────────────

def trace_to_spans(trace: Trace) -> list[dict]:
    spans = []
    ts_base = int(time.time() * 1e9)
    span_ids = [f"{i:016x}" for i in range(len(trace.steps))]

    for step in trace.steps:
        parent_id = span_ids[step.idx - 1] if step.idx > 0 else "0000000000000000"
        attrs = [
            {"key": "faultline.agent", "value": {"stringValue": step.agent}},
            {"key": "faultline.kind", "value": {"stringValue": step.kind}},
            {"key": "faultline.tool", "value": {"stringValue": step.tool or ""}},
            {"key": "faultline.input", "value": {"stringValue": step.input}},
            {"key": "faultline.output", "value": {"stringValue": step.output}},
            {"key": "faultline.status", "value": {"stringValue": step.status}},
            {"key": "faultline.tokens", "value": {"intValue": str(step.tokens)}},
            {"key": "faultline.task", "value": {"stringValue": trace.task}},
            {"key": "faultline.outcome", "value": {"stringValue": trace.outcome}},
        ]
        status_code = "STATUS_CODE_ERROR" if step.status == "error" else "STATUS_CODE_OK"
        spans.append({
            "traceId": trace.run_id.replace("-", "")[:32].ljust(32, "0"),
            "spanId": span_ids[step.idx],
            "parentSpanId": parent_id,
            "name": f"{step.agent}/{step.kind}",
            "startTimeUnixNano": str(ts_base + step.idx * 100_000_000),
            "endTimeUnixNano": str(ts_base + step.idx * 100_000_000 + 50_000_000),
            "attributes": attrs,
            "status": {"code": status_code},
        })
    return spans


class PipelineResult(dict):
    """Dictionary holding run results, while also behaving like Trace if needed."""
    def __init__(self, trace: Trace, spans: list[dict], fault: Fault):
        super().__init__({
            "run_id": trace.run_id,
            "trace": trace,
            "spans": spans,
            "fault_name": fault.name,
            "fault_root_idx": fault.root_cause_idx,
        })
        self.trace = trace
        self.spans = spans
        self.fault = fault

    def __getattr__(self, item: str):
        return getattr(self.trace, item)


def run_pipeline(
    fault: Fault | str | None = None,
    run_id: Optional[str] = None,
    seed: Optional[int] = None,
    fault_override: Optional[str] = None,
) -> PipelineResult:
    """
    Execute the full multi-agent pipeline with the given fault injected.
    Returns a PipelineResult dictionary compatible with both dict access and Trace.
    """
    if fault is not None:
        fault_obj = get_fault(fault) if isinstance(fault, str) else fault
    elif fault_override is not None:
        fault_obj = get_fault(fault_override)
    elif seed is not None:
        fname, _ = pick_fault(seed)
        fault_obj = get_fault(fname)
    else:
        fname, _ = pick_fault()
        fault_obj = get_fault(fname)

    run_id = run_id or f"demo_{uuid.uuid4().hex[:8]}"

    rec = RunRecorder(
        run_id=run_id,
        task="Summarise Q3 sales figures for the APAC region from the data warehouse",
        tenant="demo_agent",
    )

    # ── 1. planner ──
    table, date_filter = inject_fault.plan(fault_obj)
    rec.record_source(table, kind="table", version="2024-Q3")
    s0 = rec.record_step(
        "planner",
        "llm_response",
        None,
        inp={"task": "Summarise Q3 sales figures for APAC"},
        out={"table": table, "date_filter": date_filter, "region": "APAC"},
    )

    # ── 2. fetcher ──
    wh_result = _tool_query_warehouse(table, {"region": "APAC"})
    has_rows = len(wh_result.get("rows", [])) > 0
    status = "ok" if has_rows else "error"
    if not has_rows:
        wh_result["error_type"] = "empty_result"
        wh_result["error_msg"] = f"no rows returned from table '{table}'"
    s1 = rec.record_step(
        "fetcher",
        "tool_call",
        "query_warehouse",
        inp={"table": table, "filters": {"region": "APAC"}},
        out=wh_result,
        status=status,
        dependencies=[s0],
        sources=[table],
    )

    if not has_rows:
        trace = rec.finish_run(outcome="failure")
        try:
            rec.sync_to_falkordb()
        except Exception as e:
            log.debug("FalkorDB sync skipped: %s", e)
        return PipelineResult(trace, trace_to_spans(trace), fault_obj)

    raw_rows = wh_result["rows"]
    tracked_rows = [TrackedValue(r, producer_idx=s1, source_id=table) for r in raw_rows]

    # ── 3. transformer ──
    skip_fx = inject_fault.should_skip_currency(fault_obj)
    bad_df = inject_fault.should_bad_filter(fault_obj)

    currency_result = _tool_convert_currency(raw_rows, skip=skip_fx)
    s2 = rec.record_step(
        "transformer",
        "tool_call",
        "convert_currency",
        inp={"rows": tracked_rows, "skip": skip_fx},
        out=currency_result,
        dependencies=[s1],
    )

    converted_rows = currency_result["rows"]
    agg_result = _tool_aggregate(converted_rows, date_filter="bad" if bad_df else None)
    s3 = rec.record_step(
        "transformer",
        "tool_call",
        "aggregate",
        inp={"rows": converted_rows, "date_filter": "bad" if bad_df else None},
        out=agg_result,
        dependencies=[s2],
    )

    # ── 4. verifier ──
    blind = inject_fault.should_verifier_blind(fault_obj)
    if blind:
        verify_result = {
            "ok": True,
            "expected_count": len(raw_rows),
            "actual_count": len(raw_rows),
            "note": "verifier_blind fault — passed without checking",
        }
    else:
        verify_result = _tool_verify(agg_result, raw_rows, table=table, skip_fx=skip_fx)

    verify_status = "ok"
    if not verify_result.get("ok") and not blind:
        verify_result["error_type"] = "verification_failure"
        verify_result["error_msg"] = verify_result.get("error_msg") or f"expected {verify_result['expected_count']} rows, got {verify_result['actual_count']}"
        verify_status = "error"

    s4 = rec.record_step(
        "verifier",
        "tool_call",
        "verify_aggregate",
        inp={"aggregate": agg_result, "raw_rows": raw_rows},
        out=verify_result,
        status=verify_status,
        dependencies=[s3, s1],
    )

    if verify_status == "error":
        trace = rec.finish_run(outcome="failure")
        try:
            rec.sync_to_falkordb()
        except Exception as e:
            log.debug("FalkorDB sync skipped: %s", e)
        return PipelineResult(trace, trace_to_spans(trace), fault_obj)

    # ── 5. reporter ──
    total = agg_result.get("total_usd", 0)
    note = " (ESTIMATED — mixed currencies)" if skip_fx else ""

    hallucinate = inject_fault.should_hallucinate(fault_obj)
    if hallucinate == "hallucinate_numbers":
        summary = f"APAC Q3 Total Revenue: ${total + 350_000:,.2f} USD. Singapore office generated an unlogged bonus revenue of $210,000 USD."
    elif hallucinate == "hallucinate_facts":
        summary = f"APAC Q3 Total Revenue: ${total:,.2f} USD. EMEA division acquired 12 new enterprise accounts following Tokyo datacenter expansion."
    else:
        summary = f"APAC Q3 Total Revenue: ${total:,.2f} USD{note}"

    s5 = rec.record_step(
        "reporter",
        "llm_response",
        None,
        inp={"aggregate": agg_result},
        out={"summary": summary},
        dependencies=[s3, s4],
    )
    rec.record_answer(s5)

    trace = rec.finish_run(outcome="success")
    try:
        rec.sync_to_falkordb()
    except Exception as e:
        log.debug("FalkorDB sync skipped: %s", e)

    return PipelineResult(trace, trace_to_spans(trace), fault_obj)


def _build_trace(run_id: str, steps: list[Step], otel_edges: list, fault: Fault) -> Trace:
    """Build the Trace IR from collected steps."""
    from faultline.ir import DependsOnEdge

    # Build sequential dependencies: each step depends on the immediately preceding step
    # from the same agent, and each agent depends on the previous agent's last output.
    edges = []
    for i in range(1, len(steps)):
        edges.append(DependsOnEdge(from_idx=i, to_idx=i - 1, kind="native", conf=1.0))

    has_error = any(s.status == "error" for s in steps)
    outcome = "failure" if has_error else "success"
    failure_idx = next((s.idx for s in steps if s.status == "error"), None)

    return Trace(
        run_id=run_id,
        task="Summarise Q3 sales figures for the APAC region from the data warehouse",
        outcome=outcome,  # type: ignore[arg-type]
        source="demo",
        steps=steps,
        edges=edges,
        failure_idx=failure_idx,
    )


def save_trace_as_otel(trace: Trace, out_dir: Path) -> Path:
    """
    Serialize a demo trace as an OTel-compatible JSON file for ingestion.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{trace.run_id}.json"
    spans = trace_to_spans(trace)
    with open(out_path, "w") as f:
        json.dump(spans, f, indent=2)
    return out_path


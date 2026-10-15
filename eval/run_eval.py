"""
eval/run_eval.py — Evaluation harness for FaultLine.

Runs four systems (flat_log, window, slice_only, faultline) on a set of
labeled traces and computes:
  - Root-cause accuracy (exact match on step index)
  - Top-3 accuracy (true root is in the top-3 candidates)
  - LLM token cost per run
  - Wall-clock latency per run

Usage:
    python -m eval.run_eval --dataset otel --runs 20
    python -m eval.run_eval --dataset demo --runs 50 --out eval/results/demo_50.json

The --dataset flag maps to:
  otel    → traces in data/otel/*.json (demo agent output)
  trail   → traces in data/trail/*.json (TRAIL benchmark)
  whowhen → traces in data/whowhen/*.json (Who&When benchmark)
  demo    → generate fresh demo-agent runs on the fly
"""

from __future__ import annotations

import argparse
import json
import statistics
import time
from pathlib import Path
from typing import Any

from faultline.config import settings
from faultline.graph import FaultLineGraph
from faultline.ingest.otel import otel_to_trace
from faultline.ingest.trail import trail_to_trace
from faultline.ingest.whowhen import whowhen_to_trace
from faultline.investigator import investigate
from faultline.ir import Trace
from eval.baselines import BaselineDiagnosis, flat_log, slice_only, window

# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

_DATA_DIR = Path(__file__).parent.parent / "data"
_RESULTS_DIR = Path(__file__).parent / "results"


def _load_traces(dataset: str, max_runs: int) -> list[tuple[Trace, int | None]]:
    """
    Load traces from disk and return (trace, true_root_idx) pairs.

    true_root_idx is None when the dataset has no label (unlabeled).
    """
    if dataset == "otel":
        files = sorted((_DATA_DIR / "otel").glob("*.json"))[:max_runs]
        pairs: list[tuple[Trace, int | None]] = []
        for f in files:
            raw = json.loads(f.read_text())
            trace = otel_to_trace(raw, run_id=f.stem)
            label = raw.get("fault_root_idx")  # injected by demo agent
            pairs.append((trace, label))
        return pairs

    if dataset == "trail":
        files = sorted((_DATA_DIR / "trail").glob("*.json"))[:max_runs]
        pairs = []
        for f in files:
            raw = json.loads(f.read_text())
            trace = trail_to_trace(raw)
            # TRAIL uses 'fail_step_id' — we map by matching step id
            label_id = raw.get("fail_step_id")
            label = None
            if label_id:
                for s in trace.steps:
                    if s.id == label_id:
                        label = s.idx
                        break
            pairs.append((trace, label))
        return pairs

    if dataset == "whowhen":
        files = sorted((_DATA_DIR / "whowhen").glob("*.json"))[:max_runs]
        pairs = []
        for f in files:
            raw = json.loads(f.read_text())
            trace = whowhen_to_trace(raw)
            label_id = raw.get("root_cause_step")
            label = None
            if label_id:
                for s in trace.steps:
                    if s.id == label_id:
                        label = s.idx
                        break
            pairs.append((trace, label))
        return pairs

    if dataset == "demo":
        # Generate fresh runs on the fly by calling the demo agent
        from demo_agent.agent import run_pipeline  # type: ignore
        pairs = []
        for i in range(max_runs):
            result = run_pipeline(seed=i)
            trace = otel_to_trace(result["spans"], run_id=result["run_id"])
            pairs.append((trace, result.get("fault_root_idx")))
        return pairs

    raise ValueError(f"Unknown dataset: {dataset!r}")


def _accuracy(predicted: int | None, true: int | None) -> int:
    """1 if exact match, 0 otherwise. None predicted = 0."""
    if predicted is None or true is None:
        return 0
    return int(predicted == true)


def _top3_hit(candidates: list[int | None], true: int | None) -> int:
    """1 if true root appears in candidates list."""
    if true is None:
        return 0
    return int(true in candidates)


# ---------------------------------------------------------------------------
# eval runner
# ---------------------------------------------------------------------------

def run_eval(dataset: str, max_runs: int, graph_name: str = "eval") -> dict[str, Any]:
    t_start = time.perf_counter()
    print(f"[eval] Loading {dataset!r} traces (max={max_runs})…")
    pairs = _load_traces(dataset, max_runs)
    print(f"[eval] Loaded {len(pairs)} traces.")

    g = FaultLineGraph(graph_name=graph_name)

    results: list[dict[str, Any]] = []

    for i, (trace, true_root) in enumerate(pairs):
        print(f"[eval] Run {i+1}/{len(pairs)}: {trace.run_id}  true_root={true_root}")

        # Load trace into graph
        g.load_trace(trace)

        # Determine fail_idx
        fail_step = next(
            (s for s in trace.steps if s.status == "error"), None
        )
        fail_idx = fail_step.idx if fail_step else (len(trace.steps) - 1)

        # ── baseline 1: flat_log ──────────────────────────────────────────
        fl = flat_log(trace.steps, fail_idx)

        # ── baseline 2: window ────────────────────────────────────────────
        win = window(trace.steps, fail_idx)

        # ── baseline 3: slice_only ────────────────────────────────────────
        ancestors = g.backward_slice(trace.run_id, fail_idx)
        so = slice_only(trace.steps, fail_idx, ancestors)

        # ── faultline full ────────────────────────────────────────────────
        t0 = time.perf_counter()
        diag = investigate(trace, graph_name=graph_name)
        fl_latency = time.perf_counter() - t0
        fl_root = diag.root_cause_idx if diag else None

        row: dict[str, Any] = {
            "run_id": trace.run_id,
            "true_root": true_root,
            "flat_log": {
                "predicted": fl.predicted_root_idx,
                "acc": _accuracy(fl.predicted_root_idx, true_root),
                "latency_s": round(fl.latency_s, 3),
                "tokens": fl.tokens_used,
            },
            "window": {
                "predicted": win.predicted_root_idx,
                "acc": _accuracy(win.predicted_root_idx, true_root),
                "latency_s": round(win.latency_s, 3),
                "tokens": win.tokens_used,
            },
            "slice_only": {
                "predicted": so.predicted_root_idx,
                "acc": _accuracy(so.predicted_root_idx, true_root),
                "latency_s": round(so.latency_s, 3),
                "tokens": so.tokens_used,
            },
            "faultline": {
                "predicted": fl_root,
                "acc": _accuracy(fl_root, true_root),
                "latency_s": round(fl_latency, 3),
                "tokens": diag.tokens_used if diag else 0,
                "patch_applied": diag.patch_applied if diag else False,
                "replay_passed": diag.replay_passed if diag else False,
            },
        }
        results.append(row)

    # ── aggregate ─────────────────────────────────────────────────────────
    n = len(results)
    systems = ["flat_log", "window", "slice_only", "faultline"]
    summary: dict[str, Any] = {"n_runs": n, "systems": {}}
    for sys in systems:
        accs = [r[sys]["acc"] for r in results]
        lats = [r[sys]["latency_s"] for r in results]
        toks = [r[sys]["tokens"] for r in results]
        summary["systems"][sys] = {
            "accuracy": round(statistics.mean(accs), 3),
            "median_latency_s": round(statistics.median(lats), 3),
            "total_tokens": sum(toks),
            "mean_tokens_per_run": round(statistics.mean(toks), 1),
        }

    total_time = time.perf_counter() - t_start
    return {
        "dataset": dataset,
        "total_wall_s": round(total_time, 1),
        "summary": summary,
        "per_run": results,
    }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _print_summary(report: dict[str, Any]) -> None:
    print("\n" + "=" * 60)
    print(f"  FaultLine eval — dataset={report['dataset']}  n={report['summary']['n_runs']}")
    print("=" * 60)
    fmt = "  {:<12}  acc={:.1%}  median_lat={:.2f}s  tokens/run={:.0f}"
    for sys, stats in report["summary"]["systems"].items():
        print(fmt.format(
            sys,
            stats["accuracy"],
            stats["median_latency_s"],
            stats["mean_tokens_per_run"],
        ))
    print(f"\n  Total wall time: {report['total_wall_s']}s")
    print("=" * 60)


def main() -> None:
    parser = argparse.ArgumentParser(description="FaultLine evaluation harness")
    parser.add_argument("--dataset", default="demo",
                        choices=["otel", "trail", "whowhen", "demo"],
                        help="Which trace dataset to evaluate on")
    parser.add_argument("--runs", type=int, default=20,
                        help="Maximum number of runs to evaluate")
    parser.add_argument("--out", type=str, default="",
                        help="Write JSON report to this path (optional)")
    parser.add_argument("--graph", default="eval",
                        help="FalkorDB graph name to use for eval runs")
    args = parser.parse_args()

    report = run_eval(args.dataset, args.runs, graph_name=args.graph)
    _print_summary(report)

    out_path = args.out or str(
        _RESULTS_DIR / f"{args.dataset}_{args.runs}runs.json"
    )
    _RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    Path(out_path).write_text(json.dumps(report, indent=2))
    print(f"\n  Full report written to: {out_path}")


if __name__ == "__main__":
    main()

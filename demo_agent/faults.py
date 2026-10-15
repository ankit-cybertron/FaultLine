"""
demo_agent/faults.py — Fault injection registry for the demo pipeline.

Every fault is a pure function: it takes the step name and its "clean" input
dict and returns the mutated input dict that will produce a bad output.

Faults are chosen by the agent runner (agent.py) using weighted random
selection so ~40% of runs have exactly one fault injected.
"""

from __future__ import annotations

import random
from dataclasses import dataclass
from typing import Any, Callable


@dataclass
class Fault:
    name: str = "no_fault"
    description: str = "clean run with no fault injected"
    root_cause_idx: int | None = None


class _InjectFault:
    @staticmethod
    def plan(fault: Fault | str) -> tuple[str, str]:
        fname = fault.name if isinstance(fault, Fault) else str(fault)
        if fname == "wrong_table":
            return "sales_q2_apac", "2024-07-01..2024-09-30"
        return "sales_q3_apac", "2024-07-01..2024-09-30"

    @staticmethod
    def should_skip_currency(fault: Fault | str) -> bool:
        fname = fault.name if isinstance(fault, Fault) else str(fault)
        return fname == "skip_currency"

    @staticmethod
    def should_bad_filter(fault: Fault | str) -> bool:
        fname = fault.name if isinstance(fault, Fault) else str(fault)
        return fname == "bad_filter"

    @staticmethod
    def should_verifier_blind(fault: Fault | str) -> bool:
        fname = fault.name if isinstance(fault, Fault) else str(fault)
        return fname == "verifier_blind"

    @staticmethod
    def should_hallucinate(fault: Fault | str) -> str | None:
        fname = fault.name if isinstance(fault, Fault) else str(fault)
        if fname in ("hallucinate_numbers", "hallucinate_facts"):
            return fname
        return None


inject_fault = _InjectFault()

FAULT_ROOT_MAP: dict[str, int | None] = {
    "wrong_table": 0,
    "stale_cache": 1,
    "skip_currency": 2,
    "bad_filter": 3,
    "verifier_blind": 4,
    "hallucinate_numbers": 5,
    "hallucinate_facts": 5,
    "no_fault": None,
}


def get_fault(name: str) -> Fault:
    desc = FAULTS.get(name, (_no_fault, "unknown fault"))[1]
    return Fault(name=name, description=desc, root_cause_idx=FAULT_ROOT_MAP.get(name))


# ---------------------------------------------------------------------------
# fault implementations
# ---------------------------------------------------------------------------


def _wrong_table(step: str, inp: dict[str, Any]) -> dict[str, Any]:
    """Fetcher uses the wrong table — Q2 instead of Q3."""
    if step == "fetcher":
        return {**inp, "table": inp.get("table", "sales_q3_apac").replace("q3", "q2")}
    return inp


def _stale_cache(step: str, inp: dict[str, Any]) -> dict[str, Any]:
    """Fetcher returns stale cache data tagged as wrong quarter."""
    if step == "fetcher":
        return {**inp, "cache_key": "sales_q2_apac_cached", "force_cache": True}
    return inp


def _bad_filter(step: str, inp: dict[str, Any]) -> dict[str, Any]:
    """Transformer applies wrong date range — includes Q4 data."""
    if step == "transformer":
        return {**inp, "date_start": "2024-07-01", "date_end": "2024-12-31"}
    return inp


def _skip_currency(step: str, inp: dict[str, Any]) -> dict[str, Any]:
    """Transformer skips currency conversion so USD/AUD mixed."""
    if step == "transformer":
        return {**inp, "skip_currency_conversion": True}
    return inp


def _verifier_blind(step: str, inp: dict[str, Any]) -> dict[str, Any]:
    """Verifier is told to skip sanity checks — always passes."""
    if step == "verifier":
        return {**inp, "blind_pass": True}
    return inp


def _hallucinate_numbers(step: str, inp: dict[str, Any]) -> dict[str, Any]:
    """Reporter hallucinates unsupported numbers not present in the data warehouse."""
    if step == "reporter":
        return {**inp, "hallucinate": "numbers"}
    return inp


def _hallucinate_facts(step: str, inp: dict[str, Any]) -> dict[str, Any]:
    """Reporter invents external business facts unsupported by the retrieved data."""
    if step == "reporter":
        return {**inp, "hallucinate": "facts"}
    return inp


def _no_fault(_step: str, inp: dict[str, Any]) -> dict[str, Any]:
    """Clean run — no mutation."""
    return inp


# ---------------------------------------------------------------------------
# fault registry
# ---------------------------------------------------------------------------

FAULTS: dict[str, tuple[Callable[[str, dict], dict], str]] = {
    "wrong_table": (
        _wrong_table,
        "fetcher pulls Q2 table instead of Q3 — root cause: bad table name in planner output",
    ),
    "stale_cache": (
        _stale_cache,
        "fetcher returns stale Q2 cache — root cause: cache key not invalidated between quarters",
    ),
    "bad_filter": (
        _bad_filter,
        "transformer widens date range into Q4 — root cause: off-by-one in filter construction",
    ),
    "skip_currency": (
        _skip_currency,
        "transformer skips AUD→USD conversion — root cause: flag mis-set by planner",
    ),
    "verifier_blind": (
        _verifier_blind,
        "verifier passes a bad result without checking — root cause: blind_pass flag asserted",
    ),
    "hallucinate_numbers": (
        _hallucinate_numbers,
        "reporter hallucinates extra $350k revenue not in warehouse — root cause: reporter step hallucination",
    ),
    "hallucinate_facts": (
        _hallucinate_facts,
        "reporter hallucinates EMEA expansion facts not in warehouse — root cause: reporter step hallucination",
    ),
    "no_fault": (
        _no_fault,
        "clean run with no fault injected",
    ),
}

# Weighted choice: 45% chance of a fault, 55% clean
_FAULT_WEIGHTS = {
    "wrong_table": 7,
    "stale_cache": 7,
    "bad_filter": 7,
    "skip_currency": 7,
    "verifier_blind": 7,
    "hallucinate_numbers": 5,
    "hallucinate_facts": 5,
    "no_fault": 55,
}


def pick_fault(seed: int | None = None) -> tuple[str, str]:
    """
    Randomly select a fault type.

    Returns (fault_name, human_description).
    """
    rng = random.Random(seed)
    names = list(_FAULT_WEIGHTS.keys())
    weights = [_FAULT_WEIGHTS[n] for n in names]
    name = rng.choices(names, weights=weights, k=1)[0]
    _, desc = FAULTS[name]
    return name, desc


def apply_fault(fault_name: str, step: str, inp: dict[str, Any]) -> dict[str, Any]:
    """
    Apply the named fault to the given step's input dict.

    If the fault does not target this step, input is returned unchanged.
    """
    fn, _ = FAULTS[fault_name]
    return fn(step, inp)


def describe(fault_name: str) -> str:
    """Human-readable description of a fault type."""
    _, desc = FAULTS[fault_name]
    return desc

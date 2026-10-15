"""
eval/baselines.py — The three baseline systems FaultLine is compared against.

All baselines receive the same flat list of Step objects (in time order)
and the same failure annotation, and return a Diagnosis namedtuple.

  1. FlatLog   — scans the raw log linearly for keywords (no graph)
  2. Window    — examines the N steps immediately before the failure (temporal window)
  3. SliceOnly — runs backward_slice from the graph but skips origin-test judging

FaultLine itself (full loop) is in faultline/investigator.py.

The eval harness (run_eval.py) orchestrates all four systems on the same
labeled trace set and computes accuracy + token cost.
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass
from typing import Sequence

from faultline.ir import Step


# ---------------------------------------------------------------------------
# shared result type
# ---------------------------------------------------------------------------

@dataclass
class BaselineDiagnosis:
    system: str                     # "flat_log" | "window" | "slice_only"
    predicted_root_idx: int | None  # step index the system blames (-1 = unknown)
    explanation: str                # free-text
    tokens_used: int = 0
    latency_s: float = 0.0


# ---------------------------------------------------------------------------
# 1. FlatLog — linear scan, no graph
# ---------------------------------------------------------------------------

_ERROR_KEYWORDS = re.compile(
    r"\b(error|exception|failed|failure|none|null|empty|wrong|invalid|timeout)\b",
    re.IGNORECASE,
)


def flat_log(steps: Sequence[Step], _fail_idx: int) -> BaselineDiagnosis:
    """
    Walk the step list in reverse order and return the *last* step whose
    output text matches an error keyword.

    This is what a dev does when they scroll up from the crash: they stop at
    the most recent error message they see, which is often an error *symptom*
    not the root cause.
    """
    t0 = time.perf_counter()
    for step in reversed(steps):
        out = str(step.output or "")
        if _ERROR_KEYWORDS.search(out):
            return BaselineDiagnosis(
                system="flat_log",
                predicted_root_idx=step.idx,
                explanation=(
                    f"FlatLog: first error keyword found in step {step.idx} "
                    f"(agent={step.agent}, kind={step.kind}). Output snippet: "
                    f"{out[:120]!r}"
                ),
                latency_s=time.perf_counter() - t0,
            )

    return BaselineDiagnosis(
        system="flat_log",
        predicted_root_idx=None,
        explanation="FlatLog: no error keyword found in any step output.",
        latency_s=time.perf_counter() - t0,
    )


# ---------------------------------------------------------------------------
# 2. Window — look at N steps before the failure
# ---------------------------------------------------------------------------

_DEFAULT_WINDOW = 3


def window(
    steps: Sequence[Step],
    fail_idx: int,
    window_size: int = _DEFAULT_WINDOW,
) -> BaselineDiagnosis:
    """
    Examine the W steps immediately before the failure and pick the earliest
    one with a non-success status, or the first one in the window if all look
    fine (it's the best the baseline can do without graph context).
    """
    t0 = time.perf_counter()
    preceding = [s for s in steps if s.idx < fail_idx]
    window_steps = preceding[-window_size:] if len(preceding) >= window_size else preceding

    if not window_steps:
        return BaselineDiagnosis(
            system="window",
            predicted_root_idx=None,
            explanation=f"Window({window_size}): no steps before the failure to examine.",
            latency_s=time.perf_counter() - t0,
        )

    # Prefer a step with error status inside the window
    for step in window_steps:
        if step.status not in ("success", "ok", "done"):
            return BaselineDiagnosis(
                system="window",
                predicted_root_idx=step.idx,
                explanation=(
                    f"Window({window_size}): step {step.idx} has status={step.status!r} "
                    f"within the {window_size}-step look-back."
                ),
                latency_s=time.perf_counter() - t0,
            )

    # Fall back to the earliest step in the window
    first = window_steps[0]
    return BaselineDiagnosis(
        system="window",
        predicted_root_idx=first.idx,
        explanation=(
            f"Window({window_size}): no error status found in window; "
            f"defaulting to earliest step {first.idx} (agent={first.agent})."
        ),
        latency_s=time.perf_counter() - t0,
    )


# ---------------------------------------------------------------------------
# 3. SliceOnly — backward slice, no LLM judging
# ---------------------------------------------------------------------------

def slice_only(
    steps: Sequence[Step],
    fail_idx: int,
    causal_ancestors: list[int],
) -> BaselineDiagnosis:
    """
    Use the graph's backward slice result but skip the origin-test judging.

    Strategy: blame the ancestor *farthest* from the failure (the start of
    the causal chain). This is a reasonable heuristic but often wrong when
    there's a long dependency chain — the actual bad step is somewhere in
    the middle.

    Args:
        causal_ancestors: Ordered list of step indices returned by
                          graph.backward_slice() (closest first).
    """
    t0 = time.perf_counter()

    if not causal_ancestors:
        return BaselineDiagnosis(
            system="slice_only",
            predicted_root_idx=None,
            explanation="SliceOnly: backward slice returned no ancestors.",
            latency_s=time.perf_counter() - t0,
        )

    # Farthest ancestor = last element (slice returns closest-first)
    blamed = causal_ancestors[-1]
    return BaselineDiagnosis(
        system="slice_only",
        predicted_root_idx=blamed,
        explanation=(
            f"SliceOnly: slice returned {len(causal_ancestors)} ancestors; "
            f"blaming farthest ancestor step {blamed} (no per-step judging)."
        ),
        latency_s=time.perf_counter() - t0,
    )

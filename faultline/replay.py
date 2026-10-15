"""
replay.py — Restore an agent run to step k and re-execute with a patch applied.

"Replay" here means:
  1. Take all the tool outputs from steps 0..k-1 from the cache (the parts before
     the root cause are assumed correct).
  2. Apply the patch at step k (replace its input with patch.patched_input).
  3. Re-run the demo agent from step k onward, live.
  4. Run checker.py to see if the task succeeded.

For the benchmark (TRAIL/Who&When), we can't actually re-run the original agent,
so "replay" is simulated: we judge whether the patch would have fixed the step
using the judge, and mark success if the judge says the patched output is correct.

Live replay is only available for the demo agent (demo_agent/agent.py).
"""

from __future__ import annotations

import json
import logging
import time
from typing import Callable, Optional

from faultline.ir import Patch, ReplayResult, Trace

log = logging.getLogger(__name__)


# Type for the live re-run callable (injected by demo_agent)
RerunFn = Callable[[Trace, int, str], Trace]
# Takes (original_trace, from_step_idx, patched_input) → new Trace


def replay_live(
    original_trace: Trace,
    patch: Patch,
    rerun_fn: RerunFn,
    checker_fn: Callable[[Trace], bool],
) -> ReplayResult:
    """
    Live replay: re-run the actual agent from the patched step.

    rerun_fn must accept (original_trace, patch.target_idx, patch.patched_input)
    and return a new Trace representing the re-run from that point.

    checker_fn must accept the new Trace and return True if the task succeeded.
    """
    if patch.patched_input is None:
        return ReplayResult(
            run_id=patch.run_id,
            patched_from_idx=patch.target_idx,
            success=False,
            note="patch has no patched_input; cannot replay",
        )

    log.info("live replay run=%s from_step=%d", patch.run_id, patch.target_idx)
    t0 = time.monotonic()

    new_trace = rerun_fn(original_trace, patch.target_idx, patch.patched_input)
    success = checker_fn(new_trace)

    elapsed = time.monotonic() - t0
    new_failure = next((s.idx for s in new_trace.steps if s.status == "error"), None)

    log.info(
        "replay done run=%s success=%s new_failure=%s elapsed=%.1fs",
        patch.run_id, success, new_failure, elapsed,
    )

    return ReplayResult(
        run_id=patch.run_id,
        patched_from_idx=patch.target_idx,
        success=success,
        new_failure_idx=new_failure,
        note=f"live replay, elapsed={elapsed:.1f}s",
    )


def replay_simulated(
    original_trace: Trace,
    patch: Patch,
    judge_fn: Callable,  # judge_step function
    task_context: str = "",
) -> ReplayResult:
    """
    Simulated replay for benchmark traces where we can't re-run the agent.

    We judge whether the patched step input would produce a correct output,
    using the same judge. This is weaker than live replay but lets us run
    the eval on any trace, not just demo-agent traces.

    Reported separately from live replay in results.
    """
    from faultline.ir import Step

    if patch.patched_input is None:
        return ReplayResult(
            run_id=patch.run_id,
            patched_from_idx=patch.target_idx,
            success=False,
            note="no patched_input; simulated replay cannot proceed",
        )

    original_step = original_trace.step(patch.target_idx)
    patched_step = original_step.model_copy(update={"input": patch.patched_input})

    verdict, _ = judge_fn(patched_step, task_context)
    success = verdict.correct  # judge says patched input would produce correct output

    return ReplayResult(
        run_id=patch.run_id,
        patched_from_idx=patch.target_idx,
        success=success,
        note=f"simulated replay, judge says {'correct' if success else 'still wrong'}",
    )

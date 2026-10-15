"""
investigator.py — The origin test implemented as a scripted agent loop.

Algorithm (from the execution plan, Section 3):
  1. get_failure → find fail_idx
  2. backward_slice(fail_idx) → get causal ancestors, sorted by distance
  3. topological sort the slice (earliest/fewest dependencies first)
  4. judge each step in that order, cache results
  5. origin rule: earliest step where output is WRONG but ALL parents are CORRECT
  6. path_to(root, fail) → edge path for UI highlighting
  7. similar_failures(signature) → check memory for a known fix
  8. propose_patch → structured fix
  9. write explanation → 2-3 sentences, the model writes this part
 10. write FailurePattern to cross-run memory

Why "scripted loop" instead of an autonomous agent calling tools freely?
Because tool-calling flakiness on open models is a real risk in a 3.5-day
build. The loop is deterministic; the LLM only writes the explanation and
proposes the patch. That's the part where language matters.
"""

from __future__ import annotations

import json
import logging
import time
import uuid
from typing import Optional

from rich.console import Console
from rich.panel import Panel
from rich.table import Table

from faultline import graph as G
from faultline import judge as J
from faultline import llm
from faultline.config import settings
from faultline.ir import (
    Diagnosis,
    DependsOnEdge,
    FailurePattern,
    JudgeVerdict,
    Patch,
    Step,
    Trace,
)

log = logging.getLogger(__name__)
console = Console()

# ──────────────────────────────────────────────────────────────
# Explanation prompt (LLM writes this, everything else is deterministic)
# ──────────────────────────────────────────────────────────────

_EXPLAIN_SYSTEM = """\
You are a senior agent debugger. You have been given the root cause step
and the failure step of a broken agent run, along with the dependency path
between them. Write a precise 2-3 sentence diagnosis for an engineer who
will fix this.

Be specific: name the step index, the agent role, the tool (if any), and
what the output should have been. Do not use hedging language like "might"
or "possibly" — if you got here, the origin test confirmed this is the cause.
"""


def _explain(
    root_step: dict,
    fail_step: dict,
    path: list[int],
    task: str,
) -> tuple[str, int]:
    user_msg = (
        f"Task: {task}\n\n"
        f"Root cause step:\n{json.dumps(root_step, indent=2)}\n\n"
        f"Failure step:\n{json.dumps(fail_step, indent=2)}\n\n"
        f"Dependency path (step indices): {path}\n\n"
        "Write the diagnosis."
    )
    return llm.complete(
        [
            {"role": "system", "content": _EXPLAIN_SYSTEM},
            {"role": "user", "content": user_msg},
        ],
        model=settings.investigator_model,
        temperature=0.2,
        max_tokens=300,
        skip_cache=True,  # Explanations are short and cheap; skip cache for freshness
    )


# ──────────────────────────────────────────────────────────────
# Topological sort of the slice
# ──────────────────────────────────────────────────────────────

def _topo_sort(slice_items: list[dict], trace: Optional[Trace] = None) -> list[int]:
    """
    Sort slice step indices in topological order (producers before consumers).
    We use BFS on the dependency edges within the slice.
    If no trace is passed (graph-only mode), fall back to sorting by idx.
    """
    idxs = {item["idx"] for item in slice_items}
    if trace is None:
        return sorted(idxs)

    in_slice = {s.idx: s for s in trace.steps if s.idx in idxs}
    # Build adjacency: producer → consumers
    in_degree = {i: 0 for i in idxs}
    children: dict[int, list[int]] = {i: [] for i in idxs}

    for edge in trace.edges:
        if edge.from_idx in idxs and edge.to_idx in idxs:
            # from_idx consumes to_idx, so to_idx is a producer → from_idx
            children[edge.to_idx].append(edge.from_idx)
            in_degree[edge.from_idx] += 1

    queue = [i for i in idxs if in_degree[i] == 0]
    result = []
    while queue:
        node = queue.pop(0)
        result.append(node)
        for child in children.get(node, []):
            in_degree[child] -= 1
            if in_degree[child] == 0:
                queue.append(child)

    # If there are cycles (shouldn't happen in agent traces but be safe), append remaining
    remaining = [i for i in idxs if i not in result]
    return result + sorted(remaining)


# ──────────────────────────────────────────────────────────────
# Origin test
# ──────────────────────────────────────────────────────────────

def _apply_origin_test(
    ordered_idxs: list[int],
    verdicts: dict[int, JudgeVerdict],
) -> Optional[int]:
    """
    Origin rule: earliest step in topological order whose output is wrong
    while all its already-judged parents in the slice are correct.

    Returns the root cause idx, or None if we can't find a clean origin.
    """
    for idx in ordered_idxs:
        v = verdicts.get(idx)
        if v is None or not v.wrong:
            continue
        # All parents that we have verdicts for must be correct
        # (parents not in the slice are assumed OK — they're out of scope)
        parent_idxs = [i for i in ordered_idxs[:ordered_idxs.index(idx)] if i in verdicts]
        if all(verdicts[p].correct for p in parent_idxs):
            return idx
    return None


# ──────────────────────────────────────────────────────────────
# Signature for pattern matching
# ──────────────────────────────────────────────────────────────

def _build_signature(root_step: dict, fail_step: dict) -> str:
    """
    Build a coarse signature string for pattern matching.
    Format: "root_agent|root_tool|fail_agent|fail_tool"
    These get matched by tag overlap in similar_failures().
    """
    tags = [
        root_step.get("agent", "unknown"),
        root_step.get("tool", "") or "no_tool",
        fail_step.get("agent", "unknown"),
        fail_step.get("tool", "") or "no_tool",
    ]
    return "|".join(t.lower().replace(" ", "_") for t in tags)


# ──────────────────────────────────────────────────────────────
# Main entry point
# ──────────────────────────────────────────────────────────────

def investigate(
    target: str | Trace,
    graph_name: str = settings.graph_demo,
    trace: Optional[Trace] = None,
    judge_model: Optional[str] = None,
    verbose: bool = False,
) -> Diagnosis:
    """
    Run the full origin-test pipeline on a failed run.

    Parameters
    ----------
    target      : run_id string or Trace object to investigate
    graph_name  : which FalkorDB graph to query
    trace       : if provided, used for topological sort (better accuracy);
                  if None, falls back to idx ordering
    judge_model : override the judge model (for ablations)
    verbose     : print rich progress to stdout

    Returns
    -------
    Diagnosis with root_cause_idx, explanation, patch, replay result, and token cost.
    """
    t0 = time.monotonic()
    total_tokens = 0
    judge_calls = 0

    if isinstance(target, Trace):
        run_id = target.run_id
        trace = target
        try:
            G.ensure_schema(graph_name)
            G.load_trace(trace, graph_name)
        except Exception as e:
            log.debug("FalkorDB trace load skipped: %s", e)
    else:
        run_id = str(target)

    # ── Step 1: find the failure ──
    fail_idx = G.get_failure(run_id, graph_name)
    if fail_idx is None and trace:
        fail_idx = trace.failure_idx or next((s.idx for s in trace.steps if s.status == "error"), None)
    if fail_idx is None:
        raise ValueError(f"Run {run_id} has no error step in graph {graph_name}")

    if verbose:
        console.print(f"\n[bold red]▶ Investigating[/] run=[cyan]{run_id}[/] fail_step=[yellow]{fail_idx}[/]")

    # ── Step 2: backward slice ──
    slice_items = G.backward_slice(run_id, fail_idx, graph_name)

    if verbose:
        console.print(f"  slice size: {len(slice_items)} steps (from full trace)")

    if not slice_items:
        # Isolated failure with no upstream dependencies — trivial case
        root_idx = fail_idx
        explanation = f"Step {fail_idx} failed with no upstream dependencies. The error is self-contained."
        return Diagnosis(
            run_id=run_id,
            root_cause_idx=root_idx,
            failure_idx=fail_idx,
            path=[fail_idx],
            explanation=explanation,
            tokens_used=0,
            judge_calls=0,
        )

    # ── Step 3: topological sort ──
    ordered_idxs = _topo_sort(slice_items, trace)

    # ── Step 4: judge each step ──
    verdicts: dict[int, JudgeVerdict] = {}
    task_context = ""
    if trace:
        task_context = trace.task

    if verbose:
        table = Table(title="Judging slice steps", show_header=True)
        table.add_column("idx", style="dim")
        table.add_column("agent")
        table.add_column("dist")
        table.add_column("wrong")
        for item in sorted(slice_items, key=lambda x: x["idx"]):
            table.add_row(str(item["idx"]), item["agent"], str(item["dist"]), "?")
        console.print(table)

    for idx in ordered_idxs:
        step_props = G.get_step(run_id, idx, graph_name)
        if step_props is None:
            continue

        step = Step(
            run_id=run_id,
            idx=idx,
            agent=step_props.get("agent", "unknown"),
            kind=step_props.get("kind", "tool_call"),  # type: ignore[arg-type]
            tool=step_props.get("tool") or None,
            input=step_props.get("input", "{}"),
            output=step_props.get("output", "{}"),
            status=step_props.get("status", "ok"),  # type: ignore[arg-type]
            ts=float(step_props.get("ts", 0)),
            tokens=int(step_props.get("tokens", 0)),
        )

        verdict, tokens = J.judge_step(step, task_context, model=judge_model)
        verdicts[idx] = verdict
        total_tokens += tokens
        judge_calls += 1

        if verbose:
            status_str = "[red]WRONG[/]" if verdict.wrong else "[green]ok[/]"
            console.print(f"  step {idx:3d} ({step.agent}): {status_str}  {verdict.why[:80]}")

        # Early termination: if we've already found a candidate root cause
        # and subsequent steps are also wrong (inherited error), no need to go further.
        # The origin rule will pick the earliest in the ordered list.
        candidate = _apply_origin_test(ordered_idxs[: ordered_idxs.index(idx) + 1], verdicts)
        if candidate is not None:
            children_wrong = any(
                verdicts.get(later_idx, JudgeVerdict(run_id=run_id, idx=0, wrong=False, why="")).wrong
                for later_idx in ordered_idxs[ordered_idxs.index(idx) + 1:]
                if later_idx in verdicts
            )
            # Don't stop yet — need to confirm no earlier step is wronger.
            # Just a hint; the final decision is after all judgements.

    # ── Step 5: apply origin rule ──
    root_idx = _apply_origin_test(ordered_idxs, verdicts)

    if root_idx is None:
        # Couldn't find a clean origin — all judged steps are "ok" or all are "wrong".
        # Fall back to the step in the slice with the highest confidence of being wrong.
        wrong_verdicts = {idx: v for idx, v in verdicts.items() if v.wrong}
        if wrong_verdicts:
            root_idx = min(wrong_verdicts, key=lambda i: ordered_idxs.index(i))
        else:
            root_idx = fail_idx  # couldn't determine; report the symptom as the root

    if verbose:
        console.print(f"\n  [bold]Origin test → root cause: step {root_idx}[/]")

    # ── Step 6: get edge path ──
    path = G.path_to(run_id, root_idx, fail_idx, graph_name)

    # ── Step 7: check pattern memory ──
    root_props = G.get_step(run_id, root_idx, graph_name) or {}
    fail_props = G.get_step(run_id, fail_idx, graph_name) or {}
    signature = _build_signature(root_props, fail_props)

    known_patterns = G.similar_failures(signature, graph_name)
    if verbose and known_patterns:
        console.print(f"\n  [yellow]⚡ Memory hit:[/] {known_patterns[0]['fix_summary']}")

    # ── Step 8: write explanation ──
    explanation, exp_tokens = _explain(root_props, fail_props, path, task_context)
    total_tokens += exp_tokens

    if verbose:
        console.print(Panel(explanation, title="[green]Diagnosis", border_style="green"))

    # ── Step 9: propose patch & verify via replay ──
    from faultline import patch as P
    from faultline import replay as R

    patch_obj = None
    patch_applied = False
    replay_passed = False

    try:
        root_step_model = Step(
            run_id=run_id,
            idx=root_idx,
            agent=root_props.get("agent", ""),
            kind=root_props.get("kind", "tool_call"),
            tool=root_props.get("tool"),
            input=root_props.get("input", "{}"),
            output=root_props.get("output", "{}"),
            status=root_props.get("status", "ok"),
            ts=float(root_props.get("ts", 0.0)),
            tokens=int(root_props.get("tokens", 0)),
        )
        patch_obj = P.propose_patch(root_step_model)
        replay_res = R.replay(run_id, root_idx, patch_obj, graph_name=graph_name)
        patch_applied = replay_res.patch_applied
        replay_passed = replay_res.passed
    except Exception as e:
        log.debug("Patch/replay in investigator skipped: %s", e)

    # ── Step 10: link cause node for fleet grouping ──
    try:
        G.link_cause(run_id, signature, explanation, graph_name=graph_name)
    except Exception as e:
        log.debug("Link cause in FalkorDB skipped: %s", e)

    elapsed = time.monotonic() - t0
    log.info(
        "investigation done run=%s root=%d fail=%d tokens=%d judge_calls=%d elapsed=%.1fs",
        run_id, root_idx, fail_idx, total_tokens, judge_calls, elapsed,
    )

    return Diagnosis(
        run_id=run_id,
        root_cause_idx=root_idx,
        failure_idx=fail_idx,
        path=path,
        explanation=explanation,
        tokens_used=total_tokens,
        judge_calls=judge_calls,
        patch=patch_obj,
        patch_applied=patch_applied,
        replay_passed=replay_passed,
        steps_checked=ordered_idxs,
    )

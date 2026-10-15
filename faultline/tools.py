"""
faultline/tools.py — MCP Tool Server for FaultLine (Graph Hacks Track 1).

Exposes FalkorDB graph operations, forensics (origin test, patch, replay),
answer flow provenance, and fleet analysis tools via FastMCP so external agents
(Claude Code, Cursor, LangGraph) or internal investigator workflows can call them.

Core Tools:
  - explain_answer: Return final answer with its runtime causal graph flow
  - diagnose_run: Run origin test, find root cause, propose patch, verify via replay
  - get_failure: Find failing symptom step in a run
  - backward_slice: Multi-hop backward slice along DEPENDS_ON and HANDOFF_FROM edges
  - step_detail: Retrieve exact input, output, tools, and sources of a step
  - path_to: Shortest dependency path from candidate root cause to failure
  - rank_blame: PageRank-style blame ranking inside a causal slice
  - judge_step: Per-step correctness judgment with cache
  - propose_patch: Propose a structured fix for the root cause step
  - replay_from: Restore run to step k, apply patch, and rerun
  - fleet_summary: Group failed runs by shared root cause signature
"""

from __future__ import annotations

import json
import logging
from typing import Any, Optional

from fastmcp import FastMCP

from faultline import graph as G
from faultline import investigator as I
from faultline import judge as J
from faultline import patch as P
from faultline import replay as R
from faultline.claims import check_claims
from faultline.config import settings

log = logging.getLogger(__name__)

mcp = FastMCP(
    name="faultline",
    description="FaultLine: Graph-backed agent provenance, forensics, and fleet diagnosis",
)


@mcp.tool()
def explain_answer(run_id: str, graph_name: str = settings.graph_demo) -> dict:
    """
    Provenance mode (external entry point): Return the final answer for any recorded run
    together with the ordered flow of inputs, retrieved records, tool calls, and agent
    handoffs that produced it.
    """
    flow_data = G.answer_flow(run_id, graph_name=graph_name)
    claims = G.get_claims(run_id, graph_name=graph_name)
    if not claims and flow_data.get("answer_text"):
        try:
            claims = check_claims(run_id, graph_name=graph_name)
        except Exception as e:
            log.debug("Claims check error: %s", e)
    return {
        "run_id": run_id,
        "answer": flow_data.get("answer_text", ""),
        "answer_step_idx": flow_data.get("answer_step_idx"),
        "flow": flow_data.get("flow", []),
        "claims": claims,
        "n_flow_steps": len(flow_data.get("flow", [])),
    }


@mcp.tool()
def diagnose_run(run_id: str, graph_name: str = settings.graph_demo) -> dict:
    """
    Forensics mode (external entry point): Run the origin test on a failed or flagged run.
    Finds the earliest wrong step whose inputs are correct, proposes a structured patch,
    replays from the root-cause step, and verifies the fix.
    """
    diag = I.investigate(run_id, graph_name=graph_name)
    patch_dict = None
    if diag.patch:
        patch_dict = diag.patch.model_dump() if hasattr(diag.patch, "model_dump") else vars(diag.patch)

    # Link to Cause node in FalkorDB for fleet grouping
    if diag.root_cause_idx is not None:
        sig = f"step_{diag.root_cause_idx}_{diag.root_step.get('agent', 'agent')}" if hasattr(diag, "root_step") else f"cause_{diag.root_cause_idx}"
        G.link_cause(run_id, signature=sig, fix_summary=diag.explanation, graph_name=graph_name)

    return {
        "run_id": run_id,
        "root_cause_idx": diag.root_cause_idx,
        "failure_idx": diag.failure_idx,
        "causal_path": diag.causal_path,
        "explanation": diag.explanation,
        "patch": patch_dict,
        "patch_applied": diag.patch_applied,
        "replay_passed": diag.replay_passed,
        "tokens_used": diag.tokens_used,
    }


@mcp.tool()
def get_failure(run_id: str, graph_name: str = settings.graph_demo) -> dict:
    """
    Return the index and details of the first failing (error) step in the run.
    This is the symptom, not the cause — use backward_slice to find the origin.
    """
    fail_idx = G.get_failure(run_id, graph_name)
    if fail_idx is None:
        return {"fail_idx": None, "message": "no error step found"}
    step = G.get_step(run_id, fail_idx, graph_name)
    return {"fail_idx": fail_idx, "step": step}


@mcp.tool()
def backward_slice(run_id: str, fail_idx: int, graph_name: str = settings.graph_demo) -> dict:
    """
    Walk DEPENDS_ON and HANDOFF_FROM edges backward from fail_idx in FalkorDB.
    Returns causal ancestor step indices sorted by graph distance from the failure.
    """
    slice_items = G.backward_slice(run_id, fail_idx, graph_name)
    return {
        "run_id": run_id,
        "fail_idx": fail_idx,
        "slice_size": len(slice_items),
        "steps": slice_items,
    }


@mcp.tool()
def step_detail(run_id: str, idx: int, graph_name: str = settings.graph_demo) -> dict:
    """
    Retrieve all properties of a single step by run_id and step index.
    """
    step = G.get_step(run_id, idx, graph_name)
    if step is None:
        return {"error": f"step {idx} not found in run {run_id}"}
    return step


@mcp.tool()
def path_to(run_id: str, root_idx: int, fail_idx: int, graph_name: str = settings.graph_demo) -> dict:
    """
    Return the shortest edge path from root_idx to fail_idx via Cypher query.
    """
    path = G.path_to(run_id, root_idx, fail_idx, graph_name)
    return {"path": path, "length": len(path)}


@mcp.tool()
def rank_blame(run_id: str, fail_idx: int, graph_name: str = settings.graph_demo) -> dict:
    """
    PageRank-style blame ranking inside the causal slice based on in-degree and graph distance.
    """
    ranked = G.rank_blame(run_id, fail_idx, graph_name=graph_name)
    return {"ranked_steps": ranked, "count": len(ranked)}


@mcp.tool()
def judge_step(run_id: str, idx: int, graph_name: str = settings.graph_demo) -> dict:
    """
    Per-step correctness judgment: asks the judge model whether the step's output
    is correct given only its inputs. Cached by input hash.
    """
    step_dict = G.get_step(run_id, idx, graph_name)
    if not step_dict:
        return {"error": f"step {idx} not found"}
    from faultline.ir import Step
    step_obj = Step(
        run_id=run_id,
        idx=idx,
        agent=step_dict.get("agent", ""),
        kind=step_dict.get("kind", "tool_call"),
        tool=step_dict.get("tool"),
        input=step_dict.get("input", "{}"),
        output=step_dict.get("output", "{}"),
        status=step_dict.get("status", "ok"),
        ts=step_dict.get("ts", 0.0),
        tokens=step_dict.get("tokens", 0),
    )
    verdict = J.judge(step_obj)
    return {
        "idx": idx,
        "correct": verdict.correct,
        "wrong": verdict.wrong,
        "reason": verdict.reason,
        "tokens_used": verdict.tokens_used,
    }


@mcp.tool()
def propose_patch(run_id: str, root_idx: int, graph_name: str = settings.graph_demo) -> dict:
    """
    Propose a structured patch (prompt edit, argument fix, or tool config) for the root cause step.
    """
    step_dict = G.get_step(run_id, root_idx, graph_name)
    if not step_dict:
        return {"error": f"step {root_idx} not found"}
    from faultline.ir import Step
    step_obj = Step(
        run_id=run_id,
        idx=root_idx,
        agent=step_dict.get("agent", ""),
        kind=step_dict.get("kind", "tool_call"),
        tool=step_dict.get("tool"),
        input=step_dict.get("input", "{}"),
        output=step_dict.get("output", "{}"),
        status=step_dict.get("status", "ok"),
        ts=step_dict.get("ts", 0.0),
        tokens=step_dict.get("tokens", 0),
    )
    patch = P.propose_patch(step_obj)
    return patch.model_dump() if hasattr(patch, "model_dump") else vars(patch)


@mcp.tool()
def replay_from(run_id: str, root_idx: int, patch_data: dict, graph_name: str = settings.graph_demo) -> dict:
    """
    Restore run state to root_idx, apply patch, and rerun the pipeline.
    """
    from faultline.ir import Patch
    patch = Patch(**patch_data)
    result = R.replay(run_id, root_idx, patch, graph_name=graph_name)
    return result.model_dump() if hasattr(result, "model_dump") else vars(result)


@mcp.tool()
def fleet_summary(tenant: str = "", graph_name: str = settings.graph_demo) -> dict:
    """
    Fleet mode: group failed runs by shared root cause signature in FalkorDB.
    Returns: {"causes": [{"cause": str, "fix_summary": str, "runs": int, "run_ids": list[str]}]}
    """
    groups = G.fleet_summary(tenant=tenant, graph_name=graph_name)
    total_failed_runs = sum(g["runs"] for g in groups)
    return {
        "tenant": tenant or "all",
        "total_failed_runs": total_failed_runs,
        "n_root_causes": len(groups),
        "causes": groups,
    }


@mcp.tool()
def similar_failures_tool(signature: str, graph_name: str = settings.graph_demo) -> dict:
    """
    Search cross-run memory for failure patterns that share tags with this signature.
    """
    patterns = G.similar_failures(signature, graph_name)
    return {"patterns": patterns, "count": len(patterns)}


@mcp.tool()
def list_runs_tool(
    graph_name: str = settings.graph_demo,
    outcome: Optional[str] = None,
    limit: int = 50,
) -> dict:
    """
    List runs in a graph. Filter by outcome ('success', 'failure', 'error').
    """
    runs = G.list_runs(graph_name, outcome, limit)
    return {"runs": runs, "count": len(runs)}


@mcp.tool()
def run_graph_view(run_id: str, graph_name: str = settings.graph_demo) -> dict:
    """
    Return all nodes and edges for a run in Cytoscape.js format.
    """
    g = G.FaultLineGraph(graph_name=graph_name)
    return g.cytoscape_elements(run_id)

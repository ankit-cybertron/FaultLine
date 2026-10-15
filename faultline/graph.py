"""
graph.py — FalkorDB schema, loading, and all query functions.

One graph per dataset ("tenant") — so TRAIL traces and demo-agent traces
never mix node IDs. Each graph has the same schema.

Cypher is the only query language here. No in-memory graph traversal in Python
(that would defeat the point of having a graph DB).

Schema
------
(:Run  {id, task, outcome, source})
(:Step {run_id, idx, agent, kind, tool, input, output, status, ts, tokens})
(:Error {type, msg})
(:FailurePattern {id, signature, fix_summary, success_rate, use_count, example_run_id})

(Run)-[:HAS_STEP]->(Step)
(Step)-[:NEXT]->(Step)                        -- time order
(Step)-[:DEPENDS_ON {kind, conf}]->(Step)     -- data flow (from consumer to producer)
(Step)-[:HANDOFF_FROM]->(Step)               -- cross-agent handoff
(Step)-[:RAISED]->(Error)
(Run)-[:MATCHES]->(FailurePattern)            -- cross-run memory
"""

from __future__ import annotations

import json
import logging
from typing import Optional

from falkordb import FalkorDB

from faultline.config import settings
from faultline.ir import (
    DependsOnEdge,
    Diagnosis,
    FailurePattern,
    Patch,
    ReplayResult,
    Step,
    Trace,
)

log = logging.getLogger(__name__)

# ──────────────────────────────────────────────────────────────
# Cypher fragments
# ──────────────────────────────────────────────────────────────

# Schema indexes — run once at startup
_INDEXES = [
    "CREATE INDEX IF NOT EXISTS FOR (r:Run) ON (r.id)",
    "CREATE INDEX IF NOT EXISTS FOR (s:Step) ON (s.run_id, s.idx)",
    "CREATE INDEX IF NOT EXISTS FOR (fp:FailurePattern) ON (fp.signature)",
    "CREATE INDEX IF NOT EXISTS FOR (c:Cause) ON (c.signature)",
    "CREATE INDEX IF NOT EXISTS FOR (cl:Claim) ON (cl.run_id)",
    "CREATE INDEX IF NOT EXISTS FOR (src:Source) ON (src.id)",
]

# Core: walk backward from the failing step along data-flow and handoff edges.
# Returns step indices + agent names, sorted by distance from the failure.
# Stops at SLICE_DEPTH hops so the query stays O(small).
BACKWARD_SLICE = f"""
MATCH (f:Step {{run_id:$run_id, idx:$fail_idx}})
MATCH p=(f)-[:DEPENDS_ON|HANDOFF_FROM*1..{settings.slice_depth}]->(s:Step)
RETURN s.idx AS idx, s.agent AS agent, s.status AS status, min(length(p)) AS dist
ORDER BY dist
"""

# Answer flow: backward slice from the final answer step, ordered earliest first.
ANSWER_FLOW = """
MATCH (r:Run {id:$run_id})
OPTIONAL MATCH (r)-[:ANSWERED_WITH]->(ans:Step)
WITH r, coalesce(ans, [(r)-[:HAS_STEP]->(s:Step) | s][-1]) AS f
WHERE f IS NOT NULL
MATCH p=(f)-[:DEPENDS_ON|HANDOFF_FROM*0..10]->(s:Step)
RETURN s.idx AS idx, s.agent AS agent, s.kind AS kind, s.tool AS tool,
       s.input AS input, s.output AS output, min(length(p)) AS dist
ORDER BY s.idx ASC
"""

# Shortest edge path from root cause to failure — used to highlight in the UI.
PATH_TO = """
MATCH (root:Step {run_id:$run_id, idx:$root_idx})
MATCH (fail:Step {run_id:$run_id, idx:$fail_idx})
MATCH p=shortestPath((root)-[:DEPENDS_ON|HANDOFF_FROM*]->(fail))
RETURN [node IN nodes(p) | node.idx] AS path
"""

PATH_TO_FALLBACK = """
MATCH (root:Step {run_id:$run_id, idx:$root_idx})
MATCH (fail:Step {run_id:$run_id, idx:$fail_idx})
MATCH p=shortestPath((root)-[:DEPENDS_ON|HANDOFF_FROM|NEXT*]->(fail))
RETURN [node IN nodes(p) | node.idx] AS path
"""

# Fleet grouping: runs sharing a cause
FLEET_SUMMARY = """
MATCH (r:Run)-[:CAUSED_BY]->(c:Cause)
WHERE $tenant IS NULL OR $tenant = "" OR r.tenant = $tenant
RETURN c.signature AS cause, coalesce(c.fix_summary, "") AS fix_summary,
       count(r) AS runs, collect(r.id) AS run_ids
ORDER BY runs DESC
"""

LINK_CAUSE = """
MERGE (c:Cause {signature: $signature})
ON CREATE SET c.fix_summary = $fix_summary, c.success_rate = 1.0, c.count = 1
ON MATCH SET c.count = c.count + 1
WITH c
MATCH (r:Run {id: $run_id})
MERGE (r)-[:CAUSED_BY]->(c)
"""

# PageRank-style blame ranking inside a slice (in-degree & path distance)
RANK_BLAME = """
MATCH (f:Step {run_id:$run_id, idx:$fail_idx})
MATCH p=(f)-[:DEPENDS_ON|HANDOFF_FROM*1..10]->(s:Step)
WITH s, min(length(p)) AS dist
OPTIONAL MATCH (consumer:Step {run_id:$run_id})-[:DEPENDS_ON|HANDOFF_FROM]->(s)
RETURN s.idx AS idx, s.agent AS agent, s.kind AS kind, s.tool AS tool,
       count(consumer) AS in_degree, dist
ORDER BY in_degree DESC, dist ASC
"""

# Cross-run memory: find runs that matched the same failure pattern.
SIMILAR_FAILURES = """
MATCH (fp:FailurePattern)
WHERE ANY(tag IN split(fp.signature, '|') WHERE tag IN split($signature, '|'))
RETURN fp.id AS id, fp.signature AS signature, fp.fix_summary AS fix_summary,
       fp.success_rate AS success_rate, fp.use_count AS use_count
ORDER BY fp.success_rate DESC, fp.use_count DESC
LIMIT 5
"""

# Update pattern success rate after a replay attempt.
UPDATE_PATTERN = """
MATCH (fp:FailurePattern {id: $pattern_id})
SET fp.success_rate = $success_rate, fp.use_count = $use_count
"""


# ──────────────────────────────────────────────────────────────
# DB connection
# ──────────────────────────────────────────────────────────────

def _db() -> FalkorDB:
    return FalkorDB(host=settings.falkordb_host, port=settings.falkordb_port)


def get_graph(graph_name: str):
    """Return a FalkorDB graph handle. Caller is responsible for connection lifecycle."""
    return _db().select_graph(graph_name)


def ensure_schema(graph_name: str) -> None:
    """Create indexes if they don't exist. Idempotent; call at startup."""
    g = get_graph(graph_name)
    for stmt in _INDEXES:
        try:
            g.query(stmt)
        except Exception as e:
            # FalkorDB raises if an identical index already exists in some versions.
            log.debug("index stmt skipped (probably already exists): %s — %s", stmt[:60], e)
    log.info("schema ready on graph=%s", graph_name)


# ──────────────────────────────────────────────────────────────
# Loading traces
# ──────────────────────────────────────────────────────────────

def load_trace(trace: Trace, graph_name: str) -> None:
    """
    Write a Trace into FalkorDB. Idempotent: re-loading the same run_id
    overwrites existing nodes (MERGE on Run, CREATE on Steps then edges).
    """
    g = get_graph(graph_name)

    # Upsert the Run node
    g.query(
        "MERGE (r:Run {id: $id}) SET r.task=$task, r.outcome=$outcome, r.source=$source",
        {"id": trace.run_id, "task": trace.task, "outcome": trace.outcome, "source": trace.source},
    )

    # Create Step nodes and link to Run
    for step in trace.steps:
        g.query(
            """
            MERGE (s:Step {run_id: $run_id, idx: $idx})
            SET s.agent=$agent, s.kind=$kind, s.tool=$tool,
                s.input=$input, s.output=$output,
                s.status=$status, s.ts=$ts, s.tokens=$tokens
            WITH s
            MATCH (r:Run {id: $run_id})
            MERGE (r)-[:HAS_STEP]->(s)
            """,
            {
                "run_id": step.run_id,
                "idx": step.idx,
                "agent": step.agent,
                "kind": step.kind,
                "tool": step.tool or "",
                "input": step.input,
                "output": step.output,
                "status": step.status,
                "ts": step.ts,
                "tokens": step.tokens,
            },
        )

    # NEXT edges (time order)
    for i in range(len(trace.steps) - 1):
        a, b = trace.steps[i].idx, trace.steps[i + 1].idx
        g.query(
            """
            MATCH (a:Step {run_id:$run_id, idx:$a})
            MATCH (b:Step {run_id:$run_id, idx:$b})
            MERGE (a)-[:NEXT]->(b)
            """,
            {"run_id": trace.run_id, "a": a, "b": b},
        )

    # DEPENDS_ON edges (data flow)
    for edge in trace.edges:
        rel = "DEPENDS_ON" if edge.kind in ("native", "inferred") else "HANDOFF_FROM"
        g.query(
            f"""
            MATCH (consumer:Step {{run_id:$run_id, idx:$from_idx}})
            MATCH (producer:Step {{run_id:$run_id, idx:$to_idx}})
            MERGE (consumer)-[:{rel} {{kind:$kind, conf:$conf}}]->(producer)
            """,
            {
                "run_id": trace.run_id,
                "from_idx": edge.from_idx,
                "to_idx": edge.to_idx,
                "kind": edge.kind,
                "conf": edge.conf,
            },
        )

    # Error nodes for failed steps
    for step in trace.steps:
        if step.status == "error":
            out = step.output_dict()
            err_type = out.get("error_type", "unknown")
            err_msg = out.get("error_msg", step.output[:200])
            g.query(
                """
                MATCH (s:Step {run_id:$run_id, idx:$idx})
                MERGE (e:Error {type:$etype, msg:$emsg})
                MERGE (s)-[:RAISED]->(e)
                """,
                {"run_id": step.run_id, "idx": step.idx, "etype": err_type, "emsg": err_msg},
            )

    log.info("loaded run=%s steps=%d edges=%d graph=%s", trace.run_id, trace.n_steps, len(trace.edges), graph_name)


# ──────────────────────────────────────────────────────────────
# Query functions (called by tools.py)
# ──────────────────────────────────────────────────────────────

def get_failure(run_id: str, graph_name: str) -> Optional[int]:
    """
    Return the index of the first step with status='error' in this run.
    Returns None if the run has no error steps (shouldn't happen if outcome=failure,
    but worth guarding).
    """
    g = get_graph(graph_name)
    rows = g.query(
        "MATCH (s:Step {run_id:$run_id, status:'error'}) RETURN s.idx AS idx ORDER BY s.idx LIMIT 1",
        {"run_id": run_id},
    ).result_set
    return rows[0][0] if rows else None


def backward_slice(run_id: str, fail_idx: int, graph_name: str) -> list[dict]:
    """
    Return steps in the causal ancestry of fail_idx, sorted by graph distance.
    Result: [{"idx": int, "agent": str, "status": str, "dist": int}, ...]

    This is where FalkorDB earns its keep: multi-hop traversal on a stored
    property graph in one Cypher call, not Python iteration over a list.
    """
    g = get_graph(graph_name)
    rows = g.query(BACKWARD_SLICE, {"run_id": run_id, "fail_idx": fail_idx}).result_set
    return [{"idx": r[0], "agent": r[1], "status": r[2], "dist": r[3]} for r in rows]


def get_step(run_id: str, idx: int, graph_name: str) -> Optional[dict]:
    """Fetch a single step's properties from the graph."""
    g = get_graph(graph_name)
    rows = g.query(
        "MATCH (s:Step {run_id:$run_id, idx:$idx}) RETURN s",
        {"run_id": run_id, "idx": idx},
    ).result_set
    if not rows:
        return None
    node = rows[0][0]
    return dict(node.properties)


def path_to(run_id: str, root_idx: int, fail_idx: int, graph_name: str) -> list[int]:
    """
    Return the ordered list of step indices on the shortest path from root to failure.
    Used by the UI to animate the blame chain.
    """
    g = get_graph(graph_name)
    rows = g.query(PATH_TO, {"run_id": run_id, "root_idx": root_idx, "fail_idx": fail_idx}).result_set
    if rows and rows[0][0]:
        return rows[0][0]
    # Fallback including NEXT or direct pair
    rows_fallback = g.query(PATH_TO_FALLBACK, {"run_id": run_id, "root_idx": root_idx, "fail_idx": fail_idx}).result_set
    if rows_fallback and rows_fallback[0][0]:
        return rows_fallback[0][0]
    return [root_idx, fail_idx]


def answer_flow(run_id: str, graph_name: str = settings.graph_demo) -> dict:
    """
    Return the final answer and the ordered causal flow of steps/sources that produced it.
    """
    g = get_graph(graph_name)
    rows = g.query(ANSWER_FLOW, {"run_id": run_id}).result_set
    flow = [
        {
            "idx": r[0],
            "agent": r[1],
            "kind": r[2],
            "tool": r[3] or "",
            "input": r[4],
            "output": r[5],
            "dist": r[6],
        }
        for r in rows
    ]
    ans_rows = g.query(
        "MATCH (r:Run {id:$run_id})-[:ANSWERED_WITH]->(s:Step) RETURN s.idx, s.output",
        {"run_id": run_id},
    ).result_set
    if ans_rows:
        ans_idx = ans_rows[0][0]
        ans_out = ans_rows[0][1]
    elif flow:
        ans_idx = flow[-1]["idx"]
        ans_out = flow[-1]["output"]
    else:
        ans_idx = None
        ans_out = ""

    return {
        "run_id": run_id,
        "answer_step_idx": ans_idx,
        "answer_text": ans_out,
        "flow": flow,
    }


def fleet_summary(tenant: str = "", graph_name: str = settings.graph_demo) -> list[dict]:
    """
    Group failed runs sharing a root cause signature.
    """
    g = get_graph(graph_name)
    rows = g.query(FLEET_SUMMARY, {"tenant": tenant}).result_set
    return [
        {
            "cause": r[0],
            "fix_summary": r[1],
            "runs": r[2],
            "run_ids": r[3],
        }
        for r in rows
    ]


def link_cause(run_id: str, signature: str, fix_summary: str = "", graph_name: str = settings.graph_demo) -> None:
    """Link a Run to a Cause node by signature."""
    g = get_graph(graph_name)
    g.query(LINK_CAUSE, {"run_id": run_id, "signature": signature, "fix_summary": fix_summary})


def rank_blame(run_id: str, fail_idx: int, graph_name: str = settings.graph_demo) -> list[dict]:
    """
    PageRank-style blame ranking inside a causal slice: sorts slice steps by in-degree and distance.
    """
    g = get_graph(graph_name)
    rows = g.query(RANK_BLAME, {"run_id": run_id, "fail_idx": fail_idx}).result_set
    return [
        {
            "idx": r[0],
            "agent": r[1],
            "kind": r[2],
            "tool": r[3] or "",
            "in_degree": r[4],
            "dist": r[5],
        }
        for r in rows
    ]


def record_claims(run_id: str, claims: list[dict], graph_name: str = settings.graph_demo) -> None:
    """
    Record Claim nodes and link to supporting steps in FalkorDB.
    """
    g = get_graph(graph_name)
    for c in claims:
        g.query(
            """
            MERGE (cl:Claim {run_id: $run_id, text: $text})
            SET cl.supported = $supported
            WITH cl
            MATCH (r:Run {id: $run_id})
            MERGE (r)-[:HAS_CLAIM]->(cl)
            """,
            {"run_id": run_id, "text": c["text"], "supported": c.get("supported", False)},
        )
        step_idx = c.get("step_idx")
        if step_idx is not None and c.get("supported"):
            g.query(
                """
                MATCH (cl:Claim {run_id: $run_id, text: $text})
                MATCH (s:Step {run_id: $run_id, idx: $step_idx})
                MERGE (cl)-[:SUPPORTED_BY]->(s)
                """,
                {"run_id": run_id, "text": c["text"], "step_idx": step_idx},
            )


def get_claims(run_id: str, graph_name: str = settings.graph_demo) -> list[dict]:
    """Fetch all Claim nodes for a run with their supporting steps."""
    g = get_graph(graph_name)
    rows = g.query(
        """
        MATCH (cl:Claim {run_id: $run_id})
        OPTIONAL MATCH (cl)-[:SUPPORTED_BY]->(s:Step)
        RETURN cl.text AS text, cl.supported AS supported, collect(s.idx) AS supported_by
        """,
        {"run_id": run_id},
    ).result_set
    return [
        {
            "text": r[0],
            "supported": r[1],
            "supported_by": [idx for idx in r[2] if idx is not None],
        }
        for r in rows
    ]


def list_runs(graph_name: str, outcome: Optional[str] = None, limit: int = 100) -> list[dict]:
    """List runs in a graph, optionally filtered by outcome."""
    g = get_graph(graph_name)
    if outcome:
        rows = g.query(
            "MATCH (r:Run {outcome:$outcome}) RETURN r.id AS id, r.task AS task, r.outcome AS outcome, r.source AS source LIMIT $limit",
            {"outcome": outcome, "limit": limit},
        ).result_set
    else:
        rows = g.query(
            "MATCH (r:Run) RETURN r.id AS id, r.task AS task, r.outcome AS outcome, r.source AS source LIMIT $limit",
            {"limit": limit},
        ).result_set
    return [{"id": r[0], "task": r[1], "outcome": r[2], "source": r[3]} for r in rows]


def get_run_steps(run_id: str, graph_name: str) -> list[dict]:
    """All steps for a run, in order. Used by the UI graph view."""
    g = get_graph(graph_name)
    rows = g.query(
        "MATCH (s:Step {run_id:$run_id}) RETURN s ORDER BY s.idx",
        {"run_id": run_id},
    ).result_set
    return [dict(r[0].properties) for r in rows]


def get_run_edges(run_id: str, graph_name: str) -> list[dict]:
    """All DEPENDS_ON and NEXT edges for a run. Used by the UI graph view."""
    g = get_graph(graph_name)
    rows = g.query(
        """
        MATCH (a:Step {run_id:$run_id})-[rel:DEPENDS_ON|NEXT|HANDOFF_FROM]->(b:Step {run_id:$run_id})
        RETURN a.idx AS from_idx, type(rel) AS rel_type, b.idx AS to_idx,
               COALESCE(rel.kind, '') AS kind, COALESCE(rel.conf, 1.0) AS conf
        """,
        {"run_id": run_id},
    ).result_set
    return [{"from": r[0], "type": r[1], "to": r[2], "kind": r[3], "conf": r[4]} for r in rows]


# ──────────────────────────────────────────────────────────────
# Failure pattern memory
# ──────────────────────────────────────────────────────────────

def write_failure_pattern(pattern: FailurePattern, graph_name: str) -> None:
    """Upsert a FailurePattern node and link it to the run that established it."""
    g = get_graph(graph_name)
    g.query(
        """
        MERGE (fp:FailurePattern {id: $id})
        SET fp.signature=$signature, fp.fix_summary=$fix_summary,
            fp.success_rate=$success_rate, fp.use_count=$use_count,
            fp.example_run_id=$example_run_id
        WITH fp
        MATCH (r:Run {id: $example_run_id})
        MERGE (r)-[:MATCHES]->(fp)
        """,
        {
            "id": pattern.pattern_id,
            "signature": pattern.signature,
            "fix_summary": pattern.fix_summary,
            "success_rate": pattern.success_rate,
            "use_count": pattern.use_count,
            "example_run_id": pattern.example_run_id,
        },
    )
    log.info("wrote failure pattern id=%s sig=%s", pattern.pattern_id, pattern.signature)


def similar_failures(signature: str, graph_name: str) -> list[dict]:
    """
    Find failure patterns that share at least one tag with the given signature.
    Returns up to 5 results sorted by success_rate desc.
    """
    g = get_graph(graph_name)
    rows = g.query(SIMILAR_FAILURES, {"signature": signature}).result_set
    return [
        {
            "id": r[0],
            "signature": r[1],
            "fix_summary": r[2],
            "success_rate": r[3],
            "use_count": r[4],
        }
        for r in rows
    ]


def update_pattern_success(pattern_id: str, success: bool, graph_name: str) -> None:
    """Incrementally update a pattern's success rate after a replay attempt."""
    g = get_graph(graph_name)
    rows = g.query(
        "MATCH (fp:FailurePattern {id: $id}) RETURN fp.success_rate, fp.use_count",
        {"id": pattern_id},
    ).result_set
    if not rows:
        return
    old_rate, old_count = rows[0][0], rows[0][1]
    new_count = old_count + 1
    # Running average: new_rate = (old_rate * old_count + outcome) / new_count
    new_rate = (old_rate * old_count + (1 if success else 0)) / new_count
    g.query(UPDATE_PATTERN, {"pattern_id": pattern_id, "success_rate": new_rate, "use_count": new_count})


# ──────────────────────────────────────────────────────────────
# FaultLineGraph class wrapper
# ──────────────────────────────────────────────────────────────

class FaultLineGraph:
    """High-level object-oriented wrapper around FalkorDB run graph operations."""

    def __init__(self, graph_name: str = "demo_agent") -> None:
        self.graph_name = graph_name

    def ensure_schema(self) -> None:
        ensure_schema(self.graph_name)

    def load_trace(self, trace: Trace) -> None:
        load_trace(trace, self.graph_name)

    def get_failure(self, run_id: str) -> Optional[int]:
        return get_failure(run_id, self.graph_name)

    def backward_slice(self, run_id: str, fail_idx: int) -> list[dict]:
        return backward_slice(run_id, fail_idx, self.graph_name)

    def get_step(self, run_id: str, idx: int) -> Optional[dict]:
        return get_step(run_id, idx, self.graph_name)

    def path_to(self, run_id: str, root_idx: int, fail_idx: int) -> list[int]:
        return path_to(run_id, root_idx, fail_idx, self.graph_name)

    def list_runs(self, outcome: Optional[str] = None, limit: int = 100) -> list[dict]:
        return list_runs(self.graph_name, outcome, limit)

    def get_run_steps(self, run_id: str) -> list[dict]:
        return get_run_steps(run_id, self.graph_name)

    def get_run_edges(self, run_id: str) -> list[dict]:
        return get_run_edges(run_id, self.graph_name)

    def answer_flow(self, run_id: str) -> dict:
        return answer_flow(run_id, self.graph_name)

    def fleet_summary(self, tenant: str = "") -> list[dict]:
        return fleet_summary(tenant, self.graph_name)

    def link_cause(self, run_id: str, signature: str, fix_summary: str = "") -> None:
        link_cause(run_id, signature, fix_summary, self.graph_name)

    def rank_blame(self, run_id: str, fail_idx: int) -> list[dict]:
        return rank_blame(run_id, fail_idx, self.graph_name)

    def record_claims(self, run_id: str, claims: list[dict]) -> None:
        record_claims(run_id, claims, self.graph_name)

    def get_claims(self, run_id: str) -> list[dict]:
        return get_claims(run_id, self.graph_name)

    def cytoscape_elements(self, run_id: str) -> dict[str, list[dict]]:
        steps = self.get_run_steps(run_id)
        edges = self.get_run_edges(run_id)
        g = get_graph(self.graph_name)

        nodes_cyto = [
            {
                "data": {
                    "id": str(s.get("idx")),
                    "label": f"#{s.get('idx')} {s.get('agent', '')}",
                    "agent": s.get("agent", ""),
                    "kind": s.get("kind", ""),
                    "tool": s.get("tool", ""),
                    "status": s.get("status", "ok"),
                    "output_preview": (s.get("output", "")[:80] + "…") if len(s.get("output", "")) > 80 else s.get("output", ""),
                }
            }
            for s in steps
        ]

        # Add Source nodes
        try:
            src_rows = g.query(
                "MATCH (s:Step {run_id:$run_id})-[:READ]->(src:Source) RETURN DISTINCT src.id, src.kind",
                {"run_id": run_id},
            ).result_set
            for src in src_rows:
                nodes_cyto.append({
                    "data": {
                        "id": f"src_{src[0]}",
                        "label": f"📦 {src[0]}",
                        "agent": "source",
                        "kind": src[1] or "source",
                        "status": "source",
                        "output_preview": f"Source: {src[0]}",
                    }
                })
        except Exception:
            pass

        # Add Claim nodes
        try:
            cl_rows = g.query(
                "MATCH (cl:Claim {run_id:$run_id}) RETURN cl.text, cl.supported",
                {"run_id": run_id},
            ).result_set
            for i, cl in enumerate(cl_rows):
                status_icon = "✓" if cl[1] else "✗"
                nodes_cyto.append({
                    "data": {
                        "id": f"claim_{i}",
                        "label": f"{status_icon} Claim",
                        "agent": "claim",
                        "kind": "supported" if cl[1] else "unsupported",
                        "status": "claim",
                        "output_preview": cl[0],
                    }
                })
        except Exception:
            pass

        edges_cyto = [
            {
                "data": {
                    "id": f"e-{e['from']}-{e['to']}-{e.get('type', '')}",
                    "source": str(e["from"]),
                    "target": str(e["to"]),
                    "kind": e.get("type", ""),
                }
            }
            for e in edges
        ]

        # Add READ edges to sources
        try:
            read_rows = g.query(
                "MATCH (s:Step {run_id:$run_id})-[:READ]->(src:Source) RETURN s.idx, src.id",
                {"run_id": run_id},
            ).result_set
            for r in read_rows:
                edges_cyto.append({
                    "data": {
                        "id": f"read-{r[0]}-{r[1]}",
                        "source": str(r[0]),
                        "target": f"src_{r[1]}",
                        "kind": "READ",
                    }
                })
        except Exception:
            pass

        return {"nodes": nodes_cyto, "edges": edges_cyto}

    def get_patterns(self) -> list[dict]:
        g = get_graph(self.graph_name)
        rows = g.query(
            """
            MATCH (fp:FailurePattern)
            RETURN fp.id AS id, fp.signature AS signature, fp.fix_summary AS fix_summary,
                   fp.success_rate AS success_rate, fp.use_count AS use_count
            ORDER BY fp.success_rate DESC, fp.use_count DESC
            """
        ).result_set
        return [
            {
                "id": r[0],
                "signature": r[1],
                "fix_summary": r[2],
                "success_rate": r[3],
                "use_count": r[4],
            }
            for r in rows
        ]

    def write_failure_pattern(self, pattern: FailurePattern) -> None:
        write_failure_pattern(pattern, self.graph_name)

    def similar_failures(self, signature: str) -> list[dict]:
        return similar_failures(signature, self.graph_name)

    def update_pattern_success(self, pattern_id: str, success: bool) -> None:
        update_pattern_success(pattern_id, success, self.graph_name)


RunGraph = FaultLineGraph


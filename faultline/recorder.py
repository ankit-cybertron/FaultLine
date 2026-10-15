"""
faultline/recorder.py — Runtime provenance recorder for AI agent runs.

Captures steps, sources, data dependencies, and final answers as the agent executes.
Every value produced by a step can be wrapped in a TrackedValue so that downstream
prompts and tool arguments record native DEPENDS_ON edges without LLM guessing.
"""

from __future__ import annotations

import json
import logging
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Generic, Iterable, Optional, TypeVar

from faultline.ir import DependsOnEdge, Step, Trace

log = logging.getLogger(__name__)

T = TypeVar("T")


class TrackedValue(Generic[T]):
    """
    Wraps an arbitrary value with provenance metadata (producer step index or source ID).
    """

    def __init__(self, value: T, producer_idx: int | None = None, source_id: str | None = None) -> None:
        self.value = value
        self.producer_idx = producer_idx
        self.source_id = source_id

    def unwrap(self) -> T:
        return self.value

    def __repr__(self) -> str:
        origin = f"step={self.producer_idx}" if self.producer_idx is not None else f"source={self.source_id}"
        return f"TrackedValue({self.value!r}, origin={origin})"

    def __str__(self) -> str:
        return str(self.value)

    def __eq__(self, other: Any) -> bool:
        if isinstance(other, TrackedValue):
            return self.value == other.value
        return self.value == other


def unwrap(val: Any) -> Any:
    """Helper to unwrap TrackedValue or nested collections."""
    if isinstance(val, TrackedValue):
        return val.value
    if isinstance(val, dict):
        return {k: unwrap(v) for k, v in val.items()}
    if isinstance(val, (list, tuple)):
        return [unwrap(v) for v in val]
    return val


def extract_producers(items: Any) -> set[int]:
    """Recursively collect all producer step indices from arguments."""
    producers: set[int] = set()
    if isinstance(items, TrackedValue) and items.producer_idx is not None:
        producers.add(items.producer_idx)
    elif isinstance(items, dict):
        for v in items.values():
            producers.update(extract_producers(v))
    elif isinstance(items, (list, tuple, set)):
        for v in items:
            producers.update(extract_producers(v))
    return producers


@dataclass
class SourceRecord:
    id: str
    kind: str  # table, document, config, prompt_template
    version: str = "1.0"
    content_hash: str = ""


class RunRecorder:
    """
    Active runtime recorder for a single agent execution.
    Writes steps and native edges, then commits to Trace IR and FalkorDB.
    """

    def __init__(self, run_id: Optional[str] = None, task: str = "", tenant: str = "demo_agent") -> None:
        self.run_id = run_id or f"run_{uuid.uuid4().hex[:8]}"
        self.task = task
        self.tenant = tenant
        self.steps: list[Step] = []
        self.edges: list[DependsOnEdge] = []
        self.sources: dict[str, SourceRecord] = {}
        self.step_sources: list[tuple[int, str]] = []  # (step_idx, source_id)
        self.answer_step_idx: Optional[int] = None
        self.outcome: str = "success"
        self._curr_idx = 0

    def record_source(self, source_id: str, kind: str = "table", version: str = "1.0", content_hash: str = "") -> None:
        """Register an external source node (table, doc, template)."""
        self.sources[source_id] = SourceRecord(
            id=source_id,
            kind=kind,
            version=version,
            content_hash=content_hash,
        )

    def record_step(
        self,
        agent: str,
        kind: str,
        tool: Optional[str] = None,
        inp: Any = None,
        out: Any = None,
        status: str = "ok",
        tokens: int = 0,
        dependencies: Optional[Iterable[int | TrackedValue]] = None,
        sources: Optional[Iterable[str]] = None,
    ) -> int:
        """
        Record one discrete step in the run.
        Automatically infers dependencies from any passed TrackedValue objects in inp or dependencies.
        """
        idx = self._curr_idx
        self._curr_idx += 1

        clean_inp = unwrap(inp) if inp is not None else {}
        clean_out = unwrap(out) if out is not None else {}

        # Collect explicit or implicit dependencies
        dep_indices: set[int] = set()
        if dependencies:
            for dep in dependencies:
                if isinstance(dep, TrackedValue) and dep.producer_idx is not None:
                    dep_indices.add(dep.producer_idx)
                elif isinstance(dep, int):
                    dep_indices.add(dep)

        # Also inspect inp for any TrackedValue objects
        dep_indices.update(extract_producers(inp))

        # Always add a chronological dependency from previous step if no explicit deps
        # or cross-agent handoff
        if idx > 0 and not dep_indices:
            dep_indices.add(idx - 1)

        for dep_idx in sorted(dep_indices):
            if dep_idx != idx and 0 <= dep_idx < idx:
                edge_kind = "handoff" if (dep_idx < len(self.steps) and self.steps[dep_idx].agent != agent) else "native"
                self.edges.append(DependsOnEdge(from_idx=idx, to_idx=dep_idx, kind=edge_kind, conf=1.0))

        if sources:
            for s_id in sources:
                self.step_sources.append((idx, s_id))

        step = Step(
            run_id=self.run_id,
            idx=idx,
            id=f"{self.run_id}_{idx}",
            agent=agent,
            kind=kind,  # type: ignore[arg-type]
            tool=tool,
            input=json.dumps(clean_inp) if not isinstance(clean_inp, str) else clean_inp,
            output=json.dumps(clean_out) if not isinstance(clean_out, str) else clean_out,
            status=status,  # type: ignore[arg-type]
            ts=time.time(),
            tokens=tokens,
        )
        self.steps.append(step)

        if status == "error":
            self.outcome = "failure"

        return idx

    def record_answer(self, step_idx: int) -> None:
        """Mark a specific step as the final answer of this run."""
        self.answer_step_idx = step_idx

    def finish_run(self, outcome: Optional[str] = None) -> Trace:
        """Finalize the run and return the Trace IR."""
        if outcome:
            self.outcome = outcome
        elif any(s.status == "error" for s in self.steps):
            self.outcome = "failure"

        # If answer step not explicitly marked, default to the last successful step
        if self.answer_step_idx is None and self.steps:
            self.answer_step_idx = self.steps[-1].idx

        failure_idx = next((s.idx for s in self.steps if s.status == "error"), None)

        trace = Trace(
            run_id=self.run_id,
            task=self.task,
            outcome=self.outcome,  # type: ignore[arg-type]
            source="demo",
            steps=self.steps,
            edges=self.edges,
            failure_idx=failure_idx,
        )
        return trace

    def sync_to_falkordb(self, graph_name: Optional[str] = None) -> None:
        """Directly persist the run graph, sources, and ANSWERED_WITH edges to FalkorDB."""
        g_name = graph_name or self.tenant
        from faultline.graph import get_graph

        g = get_graph(g_name)

        # 1. Create Run node
        g.query(
            """
            MERGE (r:Run {id: $run_id})
            SET r.task = $task, r.outcome = $outcome, r.tenant = $tenant
            """,
            {
                "run_id": self.run_id,
                "task": self.task,
                "outcome": self.outcome,
                "tenant": self.tenant,
            },
        )

        # 2. Create Source nodes
        for src in self.sources.values():
            g.query(
                """
                MERGE (s:Source {id: $id})
                SET s.kind = $kind, s.version = $version, s.hash = $hash
                """,
                {"id": src.id, "kind": src.kind, "version": src.version, "hash": src.content_hash},
            )

        # 3. Create Step nodes
        for step in self.steps:
            g.query(
                """
                MERGE (s:Step {run_id: $run_id, idx: $idx})
                SET s.agent = $agent, s.kind = $kind, s.tool = $tool,
                    s.input = $input, s.output = $output, s.status = $status,
                    s.ts = $ts, s.tokens = $tokens
                """,
                {
                    "run_id": self.run_id,
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
            g.query(
                """
                MATCH (r:Run {id: $run_id}), (s:Step {run_id: $run_id, idx: $idx})
                MERGE (r)-[:HAS_STEP]->(s)
                """,
                {"run_id": self.run_id, "idx": step.idx},
            )

        # 4. Create NEXT chain
        for i in range(len(self.steps) - 1):
            g.query(
                """
                MATCH (a:Step {run_id: $run_id, idx: $idx_a}), (b:Step {run_id: $run_id, idx: $idx_b})
                MERGE (a)-[:NEXT]->(b)
                """,
                {"run_id": self.run_id, "idx_a": self.steps[i].idx, "idx_b": self.steps[i + 1].idx},
            )

        # 5. Create DEPENDS_ON / HANDOFF_FROM edges
        for edge in self.edges:
            rel_type = "HANDOFF_FROM" if edge.kind == "handoff" else "DEPENDS_ON"
            g.query(
                f"""
                MATCH (a:Step {{run_id: $run_id, idx: $from_idx}}), (b:Step {{run_id: $run_id, idx: $to_idx}})
                MERGE (a)-[:{rel_type} {{kind: $kind, conf: $conf}}]->(b)
                """,
                {
                    "run_id": self.run_id,
                    "from_idx": edge.from_idx,
                    "to_idx": edge.to_idx,
                    "kind": edge.kind,
                    "conf": edge.conf,
                },
            )

        # 6. Create READ Source edges
        for step_idx, s_id in self.step_sources:
            g.query(
                """
                MATCH (s:Step {run_id: $run_id, idx: $idx}), (src:Source {id: $src_id})
                MERGE (s)-[:READ]->(src)
                """,
                {"run_id": self.run_id, "idx": step_idx, "src_id": s_id},
            )

        # 7. Create ANSWERED_WITH edge
        if self.answer_step_idx is not None:
            g.query(
                """
                MATCH (r:Run {id: $run_id}), (s:Step {run_id: $run_id, idx: $ans_idx})
                MERGE (r)-[:ANSWERED_WITH]->(s)
                """,
                {"run_id": self.run_id, "ans_idx": self.answer_step_idx},
            )

        log.info("synced run %s to graph %s (steps=%d, edges=%d)", self.run_id, g_name, len(self.steps), len(self.edges))

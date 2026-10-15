"""
ir.py — Intermediate representation for a single agent run.

A Trace holds a flat list of Steps and the dependency edges between them.
Steps are the unit everything else operates on: the investigator walks them,
the judge evaluates them, the replayer re-executes from them.

Keep this model small. Tool call and output live as properties of Step, not
as separate nodes, so the graph schema and Cypher stay simple.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, model_validator


StepKind = Literal["tool_call", "llm_response", "handoff", "observation", "error"]
StepStatus = Literal["ok", "error", "skipped"]
EdgeKind = Literal["native", "inferred", "handoff"]
TraceOutcome = Literal["success", "failure", "error"]
TraceSource = Literal["trail", "whowhen", "demo", "otel"]


class Step(BaseModel):
    """One discrete unit of work within an agent run."""

    run_id: str
    idx: int  # 0-indexed, stable position; used as the graph node key
    id: Optional[str] = None

    agent: str  # which role produced this — "planner", "writer", "verifier", etc.
    kind: StepKind

    # Populated only when kind == "tool_call"
    tool: Optional[str] = None

    # Serialized as JSON strings so they round-trip through FalkorDB string properties
    # without losing structure. Deserialize with json.loads on the way out.
    input: str = "{}"
    output: str = "{}"

    status: StepStatus = "ok"
    ts: float  # unix epoch seconds
    tokens: int = 0  # tokens consumed producing this step's output

    @property
    def input_hash(self) -> str:
        """Stable cache key for (step identity, input content)."""
        payload = json.dumps({"run_id": self.run_id, "idx": self.idx, "input": self.input}, sort_keys=True)
        return hashlib.sha256(payload.encode()).hexdigest()[:16]

    @property
    def is_failure(self) -> bool:
        return self.status == "error"

    def input_dict(self) -> dict[str, Any]:
        return json.loads(self.input)

    def output_dict(self) -> dict[str, Any]:
        return json.loads(self.output)

    def summary(self, max_chars: int = 120) -> str:
        """Human-readable one-liner for logs and judge prompts."""
        tool_part = f"[{self.tool}]" if self.tool else ""
        out = self.output.replace("\n", " ")[:max_chars]
        return f"Step {self.idx} ({self.agent} / {self.kind}{tool_part}): {out}"


class DependsOnEdge(BaseModel):
    """
    Directed edge: from_idx used to_idx's output.
    Direction is from consumer to producer, matching the graph traversal
    direction in backward_slice (follow edges backward from failure to cause).
    """

    from_idx: int  # the step that CONSUMED data
    to_idx: int  # the step that PRODUCED data

    kind: EdgeKind = "native"
    # native  = span parent/child or explicit tool-result wiring in the trace
    # inferred = LLM decided these are probably connected

    conf: float = 1.0  # [0.0, 1.0]; used in blame score and ablation filters

    @model_validator(mode="after")
    def different_steps(self) -> "DependsOnEdge":
        if self.from_idx == self.to_idx:
            raise ValueError(f"Self-loop on step {self.from_idx}")
        return self


class Trace(BaseModel):
    """One agent run: steps + dependency edges + metadata."""

    run_id: str
    task: str  # natural language description of what the run was supposed to do
    outcome: TraceOutcome
    source: TraceSource

    steps: list[Step] = Field(default_factory=list)
    edges: list[DependsOnEdge] = Field(default_factory=list)

    # Populated after parsing; None means "unknown" not "no failure"
    failure_idx: Optional[int] = None

    # Ground truth for evaluation. None means "no label available".
    root_cause_idx: Optional[int] = None

    @model_validator(mode="after")
    def steps_sorted(self) -> "Trace":
        self.steps = sorted(self.steps, key=lambda s: s.idx)
        return self

    def step(self, idx: int) -> Step:
        """O(n) but n is small; add a dict if it ever matters."""
        for s in self.steps:
            if s.idx == idx:
                return s
        raise KeyError(f"Step {idx} not found in run {self.run_id}")

    def failure_step(self) -> Optional[Step]:
        if self.failure_idx is not None:
            return self.step(self.failure_idx)
        # Fall back: last step with status == error
        errors = [s for s in self.steps if s.status == "error"]
        return errors[-1] if errors else None

    def parents_of(self, idx: int) -> list[int]:
        """Steps whose output idx consumed (producers of idx's inputs)."""
        return [e.to_idx for e in self.edges if e.from_idx == idx]

    def children_of(self, idx: int) -> list[int]:
        """Steps that consumed idx's output."""
        return [e.from_idx for e in self.edges if e.to_idx == idx]

    @property
    def n_steps(self) -> int:
        return len(self.steps)

    @property
    def n_native_edges(self) -> int:
        return sum(1 for e in self.edges if e.kind == "native")

    @property
    def n_inferred_edges(self) -> int:
        return sum(1 for e in self.edges if e.kind == "inferred")


class JudgeVerdict(BaseModel):
    """What judge_step returns for a single step."""

    run_id: str
    idx: int
    wrong: bool  # True = this step's output is incorrect given its inputs
    why: str  # one sentence; empty string when wrong=False
    confidence: float = 1.0  # [0, 1]; judge's self-reported certainty

    @property
    def correct(self) -> bool:
        return not self.wrong


class Diagnosis(BaseModel):
    """The investigator's final answer for a failed run."""

    run_id: str
    root_cause_idx: int  # the origin step
    failure_idx: int  # the symptom step
    path: list[int]  # ordered step indices from root_cause to failure
    explanation: str  # 2-3 sentences written by the investigator LLM
    tokens_used: int  # total across all judge + investigator calls
    judge_calls: int  # number of step judgments made (useful for memory ablation)

    # populated after patch + replay phase
    patch: Optional["Patch"] = None
    patch_applied: bool = False
    replay_passed: bool = False
    steps_checked: list[int] = []  # indices of steps the origin test evaluated

    @property
    def causal_path(self) -> list[int]:
        """Alias for `path` — used by UI and eval harness."""
        return self.path


class Patch(BaseModel):
    """A structured fix proposal from propose_patch."""

    run_id: str
    target_idx: int  # which step to fix
    kind: Literal["prompt_edit", "arg_fix", "tool_config", "skip"]
    diff: str  # human-readable description of what changes
    # For replay: the patched input to substitute at target_idx
    patched_input: Optional[str] = None


class ReplayResult(BaseModel):
    """Outcome of replaying a run from a patched step."""

    run_id: str
    patched_from_idx: int
    success: bool  # did the task succeed after the patch?
    new_failure_idx: Optional[int] = None  # if still failing, where?
    note: str = ""


class FailurePattern(BaseModel):
    """
    Cross-run memory. Written after a verified fix; read by similar_failures.
    Signature is a short string that characterizes the fault class
    (e.g. "stale_tool_output|table_lookup") so fuzzy matching stays cheap.
    """

    pattern_id: str
    signature: str  # pipe-separated tags, lowercase
    fix_summary: str  # one sentence: what the fix is
    example_run_id: str  # the run that established this pattern
    success_rate: float = 1.0  # updated on each reuse; fraction of times fix worked
    use_count: int = 1

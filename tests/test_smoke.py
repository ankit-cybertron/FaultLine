"""
tests/test_smoke.py — Core smoke and unit tests for FaultLine.
"""

import json
from demo_agent.agent import run_pipeline
from demo_agent.checker import check, check_from_run
from faultline.config import settings
from faultline.ingest.otel import otel_to_trace
from faultline.ir import (
    Diagnosis,
    FailurePattern,
    Patch,
    ReplayResult,
    Step,
    Trace,
)


def test_ir_models():
    step = Step(
        run_id="run_1",
        idx=0,
        id="s0",
        agent="planner",
        kind="llm_response",
        input=json.dumps({"task": "test"}),
        output=json.dumps({"table": "sales_q3"}),
        status="ok",
        ts=1700000000.0,
    )
    assert step.idx == 0
    assert not step.is_failure
    assert step.input_dict()["task"] == "test"

    trace = Trace(
        run_id="run_1",
        task="Test task",
        outcome="success",
        source="demo",
        steps=[step],
    )
    assert trace.n_steps == 1
    assert trace.root_cause_idx is None

    diag = Diagnosis(
        run_id="run_1",
        root_cause_idx=0,
        failure_idx=4,
        path=[0, 1, 4],
        explanation="planner selected wrong table",
        tokens_used=150,
        judge_calls=3,
        steps_checked=[4, 3, 2, 1, 0],
        patch_applied=True,
        replay_passed=True,
    )
    assert diag.root_cause_idx == 0
    assert diag.replay_passed is True


def test_demo_agent_clean_run():
    res = run_pipeline(fault_override="no_fault")
    assert res["run_id"].startswith("demo_")
    assert res["fault_name"] == "no_fault"
    assert res["fault_root_idx"] is None
    assert len(res["spans"]) >= 5

    trace = otel_to_trace(res["spans"], run_id=res["run_id"])
    assert trace.outcome == "success"
    assert trace.failure_idx is None

    step_dicts = [s.model_dump() for s in trace.steps]
    chk = check_from_run(step_dicts, fault_name="no_fault")
    assert chk.passed is True


def test_demo_agent_fault_injection():
    res = run_pipeline(fault_override="wrong_table")
    assert res["fault_name"] == "wrong_table"
    assert res["fault_root_idx"] == 0

    trace = otel_to_trace(res["spans"], run_id=res["run_id"])
    assert trace.outcome == "failure"
    assert trace.failure_idx == 4  # caught by verifier

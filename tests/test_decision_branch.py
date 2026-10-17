"""
tests/test_decision_branch.py — Unit and integration tests for Decision Branch feature.

Verifies:
  1. interpret JSON validation and fallback
  2. CONSIDERED edges are excluded from backward_slice
  3. chosen candidate is in the synthesis prompt (assert on recorded prompt)
  4. clarify flow triggers when confidences are close (< 0.15)
"""

from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

import pytest
from faultline.chat_agent import (
    InterpretationCandidate,
    InterpretationOutput,
    _interpret_query,
    run_chat_turn,
)
from faultline.graph import FaultLineGraph
from faultline.recorder import RunRecorder


def test_interpret_validation_and_fallback():
    # 1. Fallback when API raises an exception
    with patch("faultline.chat_agent._groq.chat.completions.create", side_effect=RuntimeError("API error")):
        res = _interpret_query("what is apple", [])
        assert isinstance(res, InterpretationOutput)
        assert len(res.candidates) == 1
        assert res.candidates[0].chosen is True
        assert res.candidates[0].confidence == 1.0
        assert res.ambiguous is False
        assert res.clarify_question is None

    # 2. Successful parsing of ambiguous query JSON
    mock_resp = MagicMock()
    mock_resp.choices = [
        MagicMock(
            message=MagicMock(
                content=json.dumps({
                    "ambiguous": True,
                    "candidates": [
                        {
                            "label": "Apple Inc.",
                            "description": "Technology company",
                            "confidence": 0.55,
                            "favored_by": ["none"],
                            "reason": "Popular tech brand",
                        },
                        {
                            "label": "Apple (fruit)",
                            "description": "Edible pomaceous fruit",
                            "confidence": 0.45,
                            "favored_by": ["none"],
                            "reason": "Common fruit",
                        },
                    ],
                    "chosen": "Apple Inc.",
                    "clarify_question": "Did you mean the company or the fruit?",
                })
            )
        )
    ]
    with patch("faultline.chat_agent._groq.chat.completions.create", return_value=mock_resp):
        res = _interpret_query("what is apple", [])
        assert res.ambiguous is True
        assert len(res.candidates) == 2
        assert res.chosen == "Apple Inc."
        assert res.clarify_question == "Did you mean the company or the fruit?"


def test_considered_edges_excluded_from_backward_slice():
    run_id = "test_decision_slice_01"
    rec = RunRecorder(run_id=run_id, task="what is apple", tenant="test_decision_graph")

    # Step 0: input
    idx_input = rec.record_step(agent="chat_agent", kind="chat_input", inp="what is apple")

    # Step 1: context_selection
    idx_ctx = rec.record_step(agent="chat_agent", kind="context_selection", dependencies=[idx_input])

    # Step 2: decision
    idx_dec = rec.record_step(agent="chat_agent", kind="decision", tool="interpret", dependencies=[idx_ctx])

    # Step 3: candidate 1 (chosen)
    idx_c1 = rec.record_step(agent="chat_agent", kind="candidate", tool="interpret_candidate", inp={"label": "Apple Inc."}, dependencies=[idx_dec])
    rec.record_considered(decision_idx=idx_dec, candidate_idx=idx_c1, chosen=True, confidence=0.7)

    # Step 4: candidate 2 (rejected - NO DEPENDS_ON to synthesis or decision)
    idx_c2 = rec.record_step(agent="chat_agent", kind="candidate", tool="interpret_candidate", inp={"label": "Apple (fruit)"}, dependencies=[])
    rec.record_considered(decision_idx=idx_dec, candidate_idx=idx_c2, chosen=False, confidence=0.3)

    # Step 5: synthesis (depends strictly on chosen candidate)
    idx_synth = rec.record_step(agent="chat_agent", kind="synthesis", tool="synthesis", inp={"interpretation": "Apple Inc."}, dependencies=[idx_c1])

    # Step 6: answer
    idx_out = rec.record_step(agent="chat_agent", kind="chat_output", tool="answer", inp={"synthesis": idx_synth}, dependencies=[idx_synth])
    rec.record_answer(idx_out)

    rec.finish_run(outcome="success")

    # In-memory assertions on recorder
    assert len(rec.considered_edges) == 2
    c1_rec = next(c for c in rec.considered_edges if c["candidate_idx"] == idx_c1)
    assert c1_rec["chosen"] is True
    assert c1_rec["confidence"] == 0.7

    c2_rec = next(c for c in rec.considered_edges if c["candidate_idx"] == idx_c2)
    assert c2_rec["chosen"] is False
    assert c2_rec["confidence"] == 0.3

    # Assert that no DEPENDS_ON edge was created for rejected candidate idx_c2
    edge_to_indices = {e.to_idx for e in rec.edges}
    edge_from_indices = {e.from_idx for e in rec.edges}
    assert idx_c1 in edge_to_indices or idx_c1 in edge_from_indices
    assert idx_c2 not in edge_to_indices
    assert idx_c2 not in edge_from_indices

    # Mock FalkorDB graph to verify Cypher generation and query handling
    mock_graph = MagicMock()
    executed_queries = []

    def mock_query(cypher, params=None):
        executed_queries.append((cypher, params))
        result = MagicMock()
        if "BACKWARD_SLICE" in cypher or "DEPENDS_ON|HANDOFF_FROM" in cypher:
            # Traversal returns chosen candidate c1, but NOT rejected candidate c2
            result.result_set = [
                (idx_c1, "chat_agent", "ok", 1),
                (idx_dec, "chat_agent", "ok", 2),
                (idx_ctx, "chat_agent", "ok", 3),
                (idx_input, "chat_agent", "ok", 4),
            ]
        elif "rel:DEPENDS_ON|NEXT|HANDOFF_FROM|CONSIDERED" in cypher:
            result.result_set = [
                (idx_synth, "DEPENDS_ON", idx_c1, "native", 1.0, False),
                (idx_dec, "CONSIDERED", idx_c1, "", 0.7, True),
                (idx_dec, "CONSIDERED", idx_c2, "", 0.3, False),
            ]
        elif "FAVORED_BY" in cypher:
            result.result_set = []
        else:
            result.result_set = []
        return result

    mock_graph.query.side_effect = mock_query

    with patch("faultline.graph.get_graph", return_value=mock_graph):
        rec.sync_to_falkordb(graph_name="test_decision_graph")

        # Verify sync_to_falkordb executed CONSIDERED queries
        considered_queries = [
            (cypher, params) for cypher, params in executed_queries
            if "CONSIDERED" in cypher and params and "cand_idx" in params
        ]
        assert len(considered_queries) == 2

        # Verify backward_slice via FaultLineGraph
        g = FaultLineGraph(graph_name="test_decision_graph")
        slice_steps = g.backward_slice(run_id, fail_idx=idx_synth)
        slice_indices = {s["idx"] for s in slice_steps}

        assert idx_c1 in slice_indices
        assert idx_c2 not in slice_indices

        # Check get_run_edges via FaultLineGraph
        edges = g.get_run_edges(run_id)
        considered_edges = [e for e in edges if e["type"] == "CONSIDERED"]
        assert len(considered_edges) == 2

        c1_edge = next(e for e in considered_edges if e["to"] == idx_c1)
        assert c1_edge["chosen"] is True
        assert c1_edge["conf"] == 0.7

        c2_edge = next(e for e in considered_edges if e["to"] == idx_c2)
        assert c2_edge["chosen"] is False
        assert c2_edge["conf"] == 0.3


def test_chosen_candidate_in_synthesis_prompt():
    gen = run_chat_turn(
        user_message="What is apple?",
        history=[],
        graph_name="test_live_chat",
        forced_interpretation="Apple Inc. (Tech Company)",
    )
    synth_step = None
    for chunk in gen:
        if chunk.startswith("event: step"):
            data = json.loads(chunk.split("data: ")[1].strip())
            step = data.get("step", {})
            if step.get("kind") == "synthesis":
                synth_step = step

    assert synth_step is not None
    synth_input = json.loads(synth_step["input"]) if isinstance(synth_step["input"], str) else synth_step["input"]
    assert "interpretation" in synth_input
    assert synth_input["interpretation"] == "Apple Inc. (Tech Company)"
    assert "Interpret the question as: Apple Inc. (Tech Company)" in synth_input.get("interpretation_instruction", "")

    # Check that system prompt messages contain the instruction
    messages = synth_input.get("messages", [])
    system_content = messages[0].get("content", "")
    assert "Interpret the question as: Apple Inc. (Tech Company)" in system_content


def test_clarify_flow_triggers_when_confidences_are_close():
    mock_resp = MagicMock()
    mock_resp.choices = [
        MagicMock(
            message=MagicMock(
                content=json.dumps({
                    "ambiguous": True,
                    "candidates": [
                        {
                            "label": "Apple Inc.",
                            "description": "The iPhone manufacturer",
                            "confidence": 0.52,
                            "favored_by": ["none"],
                            "reason": "Tech reference",
                        },
                        {
                            "label": "Apple (fruit)",
                            "description": "The pomaceous fruit",
                            "confidence": 0.48,
                            "favored_by": ["none"],
                            "reason": "Fruit reference",
                        },
                    ],
                    "chosen": "Apple Inc.",
                    "clarify_question": "Did you mean Apple Inc. or Apple the fruit?",
                })
            )
        )
    ]

    with patch("faultline.chat_agent._groq.chat.completions.create", return_value=mock_resp):
        gen = run_chat_turn(
            user_message="what is apple",
            history=[],
            graph_name="test_live_chat",
        )
        clarify_event = None
        has_synth = False
        for chunk in gen:
            if chunk.startswith("event: clarify"):
                clarify_event = json.loads(chunk.split("data: ")[1].strip())
            elif chunk.startswith("event: step"):
                data = json.loads(chunk.split("data: ")[1].strip())
                if data.get("step", {}).get("kind") == "synthesis":
                    has_synth = True

        assert clarify_event is not None
        assert clarify_event["clarify_question"] == "Did you mean Apple Inc. or Apple the fruit?"
        assert len(clarify_event["candidates"]) == 2
        # Synthesis must NOT have run since clarification was requested
        assert has_synth is False

    # Now verify re-running with forced_interpretation bypasses clarification and executes synthesis
    gen_forced = run_chat_turn(
        user_message="what is apple",
        history=[],
        graph_name="test_live_chat",
        forced_interpretation="Apple (fruit)",
    )
    forced_clarify_event = None
    synth_step = None
    for chunk in gen_forced:
        if chunk.startswith("event: clarify"):
            forced_clarify_event = json.loads(chunk.split("data: ")[1].strip())
        elif chunk.startswith("event: step"):
            data = json.loads(chunk.split("data: ")[1].strip())
            if data.get("step", {}).get("kind") == "synthesis":
                synth_step = data.get("step")

    assert forced_clarify_event is None
    assert synth_step is not None

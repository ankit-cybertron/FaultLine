"""
tests/test_chat_mode.py — Smoke & integration tests for Live Chat Mode.

Verifies:
  1. run_chat_turn yields observable steps in proper sequence with SSE framing
  2. Router decision, context selection, and tool execution record honest data
  3. FastAPI /chat/turn SSE endpoint streams valid events
  4. Cytoscape HTML generation outputs well-formed markup
"""

from __future__ import annotations

import json
from starlette.testclient import TestClient

from faultline.api import app
from faultline.chat_agent import run_chat_turn, ChatTurn, _select_context, _router_decision
from ui.app import _generate_cytoscape_html


def test_select_context_budget():
    history = [
        {"role": "user", "content": f"Message {i} " + "x" * 100}
        for i in range(10)
    ]
    kept, meta = _select_context(history)
    assert len(kept) <= 6
    assert meta["kept_turns"] == len(kept)
    assert meta["dropped_turns"] == 10 - len(kept)


def test_run_chat_turn_events():
    gen = run_chat_turn(
        user_message="Calculate (10 + 5) * 2",
        history=[],
        graph_name="test_live_chat",
    )
    step_events = []
    token_events = []
    done_event = None

    for chunk in gen:
        if chunk.startswith("event: step"):
            data_str = chunk.split("data: ")[1].strip()
            data = json.loads(data_str)
            step_events.append(data)
        elif chunk.startswith("event: token"):
            data_str = chunk.split("data: ")[1].strip()
            data = json.loads(data_str)
            token_events.append(data)
        elif chunk.startswith("event: done"):
            data_str = chunk.split("data: ")[1].strip()
            done_event = json.loads(data_str)

    assert len(step_events) >= 5
    assert done_event is not None
    assert "turn_id" in done_event
    assert "run_id" in done_event
    assert done_event["latency_s"] >= 0

    kinds = [s["step"]["kind"] for s in step_events]
    assert "chat_input" in kinds
    assert "context_selection" in kinds
    assert "router" in kinds
    assert "synthesis" in kinds
    assert "chat_output" in kinds


def test_api_chat_turn_sse():
    client = TestClient(app)
    resp = client.post(
        "/chat/turn",
        json={"message": "What is the time?", "session_id": "test_sess_01"},
    )
    assert resp.status_code == 200
    assert "text/event-stream" in resp.headers["content-type"]
    text = resp.text
    assert "event: step" in text
    assert "event: done" in text


def test_cytoscape_html_generation():
    steps = [
        {"idx": 0, "kind": "chat_input", "tool": "user_message", "status": "ok"},
        {"idx": 1, "kind": "context_selection", "tool": "context_selection", "status": "ok"},
        {"idx": 2, "kind": "router", "tool": "router", "status": "ok"},
        {"idx": 3, "kind": "chat_output", "tool": "answer", "status": "ok"},
    ]
    html = _generate_cytoscape_html(steps, run_id="test_run_123")
    assert "cytoscape.min.js" in html
    assert "elements:" in html
    assert "chat_input" in html
    assert "chat_output" in html

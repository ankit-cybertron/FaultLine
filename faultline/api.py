"""
faultline/api.py — FastAPI HTTP server for FaultLine.

Exposes the investigation pipeline as REST endpoints so the UI and external
tools can call it without going through MCP.

Endpoints:
  POST /investigate          — ingest + investigate a raw OTel trace
  GET  /runs/{run_id}        — fetch stored run from FalkorDB
  GET  /runs/{run_id}/graph  — cytoscape-compatible graph JSON for the UI
  GET  /patterns             — all stored FailurePatterns
  GET  /health               — service health check
"""

from __future__ import annotations

import json
import time
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from faultline.config import settings
from faultline.graph import FaultLineGraph
from faultline.ingest.otel import otel_to_trace
from faultline.investigator import investigate

# ── in-process chat session store ─────────────────────────────────────────────
# Maps session_id → list of {role, content} history dicts.
# Replace with Redis for a multi-worker deployment.
_chat_sessions: dict[str, list[dict]] = {}


app = FastAPI(
    title="FaultLine API",
    description="Agent failure forensics — backprop for agent runs",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── models ────────────────────────────────────────────────────────────────────

class InvestigateRequest(BaseModel):
    spans: list[dict[str, Any]]        # OTel span list
    run_id: str | None = None
    graph_name: str = "demo_agent"


class InvestigateResponse(BaseModel):
    run_id: str
    root_cause_idx: int | None
    causal_path: list[int]
    explanation: str
    patch: dict[str, Any] | None
    patch_applied: bool
    replay_passed: bool
    tokens_used: int
    latency_s: float


# ── endpoints ─────────────────────────────────────────────────────────────────

@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "version": "0.1.0"}


@app.post("/investigate", response_model=InvestigateResponse)
def investigate_endpoint(req: InvestigateRequest) -> InvestigateResponse:
    t0 = time.perf_counter()
    try:
        trace = otel_to_trace(req.spans, run_id=req.run_id or "api_run")
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Trace parsing failed: {e}")

    try:
        g = FaultLineGraph(graph_name=req.graph_name)
        g.load_trace(trace)
        diag = investigate(trace, graph_name=req.graph_name)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Investigation failed: {e}")

    latency = round(time.perf_counter() - t0, 3)

    patch_dict: dict | None = None
    if diag and diag.patch:
        try:
            patch_dict = diag.patch.model_dump()
        except Exception:
            patch_dict = vars(diag.patch)

    return InvestigateResponse(
        run_id=trace.run_id,
        root_cause_idx=diag.root_cause_idx if diag else None,
        causal_path=diag.causal_path if diag else [],
        explanation=diag.explanation if diag else "Investigation returned no result.",
        patch=patch_dict,
        patch_applied=diag.patch_applied if diag else False,
        replay_passed=diag.replay_passed if diag else False,
        tokens_used=diag.tokens_used if diag else 0,
        latency_s=latency,
    )


@app.get("/runs/{run_id}/graph")
def run_graph(run_id: str, graph_name: str = "demo_agent") -> dict[str, Any]:
    """
    Return a cytoscape.js-compatible elements list for the given run.

    nodes: [{data: {id, label, agent, kind, status}}]
    edges: [{data: {id, source, target, kind}}]
    """
    try:
        g = FaultLineGraph(graph_name=graph_name)
        cyto = g.cytoscape_elements(run_id)
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))

    return cyto


@app.get("/runs")
def list_runs(graph_name: str = "demo_agent", outcome: str | None = None, limit: int = 50) -> list[dict[str, Any]]:
    try:
        g = FaultLineGraph(graph_name=graph_name)
        return g.list_runs(outcome=outcome, limit=limit)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/runs/{run_id}/flow")
def run_flow(run_id: str, graph_name: str = "demo_agent") -> dict[str, Any]:
    """
    Return the final answer and its causal graph flow (provenance mode).
    """
    try:
        g = FaultLineGraph(graph_name=graph_name)
        return g.answer_flow(run_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/runs/{run_id}/claims")
def run_claims(run_id: str, graph_name: str = "demo_agent") -> list[dict[str, Any]]:
    """
    Return extracted atomic claims and support status in the causal graph flow.
    """
    try:
        g = FaultLineGraph(graph_name=graph_name)
        return g.get_claims(run_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/runs/{run_id}/claims/check")
def run_claims_check(run_id: str, graph_name: str = "demo_agent") -> list[dict[str, Any]]:
    """
    Run claim extraction and verification against causal flow steps.
    """
    try:
        from faultline.claims import check_claims
        return check_claims(run_id, graph_name=graph_name)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/fleet")
def fleet_summary_endpoint(tenant: str = "", graph_name: str = "demo_agent") -> dict[str, Any]:
    """
    Fleet mode: group failed runs by shared root cause signature.
    """
    try:
        g = FaultLineGraph(graph_name=graph_name)
        groups = g.fleet_summary(tenant=tenant)
        total_runs = sum(g["runs"] for g in groups)
        return {
            "tenant": tenant or "all",
            "total_failed_runs": total_runs,
            "n_root_causes": len(groups),
            "causes": groups,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/patterns")
def list_patterns(graph_name: str = "demo_agent") -> list[dict[str, Any]]:
    try:
        g = FaultLineGraph(graph_name=graph_name)
        return g.get_patterns()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── LIVE CHAT MODE ────────────────────────────────────────────────────────────

class ChatTurnRequest(BaseModel):
    message: str
    session_id: str = "default"
    graph_name: str = "live_chat"


@app.post("/chat/turn")
def chat_turn(req: ChatTurnRequest) -> StreamingResponse:
    """
    Send a user message and stream back SSE events, one per decision step.

    Each event is:
        event: step
        data: {"turn_id": "...", "step": {idx, kind, tool, input, output, status, ts}}

    Token events (during streaming synthesis):
        event: token
        data: {"turn_id": "...", "token": "..."}

    Final event:
        event: done
        data: {"turn_id": "...", "run_id": "...", "latency_s": 1.2, "tokens": 345, "n_steps": 7}

    After done, call GET /chat/{run_id}/graph to get the cytoscape graph.
    """
    from faultline.chat_agent import run_chat_turn

    session_id = req.session_id
    history = _chat_sessions.setdefault(session_id, [])

    def generate():
        turn = None
        gen = run_chat_turn(
            user_message=req.message,
            history=history,
            graph_name=req.graph_name,
        )
        try:
            while True:
                chunk = next(gen)
                yield chunk
        except StopIteration as exc:
            turn = exc.value

        # Append to session history after the turn completes
        if turn is not None:
            history.append({"role": "user", "content": req.message})
            history.append({"role": "assistant", "content": turn.assistant_answer})
            # Trim to last 20 messages to avoid unbounded growth
            _chat_sessions[session_id] = history[-20:]

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",    # tell nginx not to buffer SSE
        },
    )


@app.get("/chat/{run_id}/graph")
def chat_run_graph(run_id: str, graph_name: str = "live_chat") -> dict[str, Any]:
    """
    Return a cytoscape.js-compatible elements list for a completed chat turn run.
    Identical shape to GET /runs/{run_id}/graph — reuses existing UI graph renderer.
    """
    try:
        g = FaultLineGraph(graph_name=graph_name)
        return g.cytoscape_elements(run_id)
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.get("/chat/sessions/{session_id}/history")
def chat_history(session_id: str) -> list[dict]:
    """Return the raw message history for a session (role + content)."""
    return _chat_sessions.get(session_id, [])


@app.delete("/chat/sessions/{session_id}")
def clear_chat_session(session_id: str) -> dict[str, str]:
    """Reset a chat session (clears history)."""
    _chat_sessions.pop(session_id, None)
    return {"status": "cleared", "session_id": session_id}


# ── run directly ──────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=settings.api_port, log_level="info")


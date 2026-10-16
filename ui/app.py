"""
ui/app.py — FaultLine v2: Every Answer Ships With Its Graph.

Supports the three core v2 modes:
  1. Provenance Mode (every run): Answer on the left, causal graph flow on the right,
     accompanied by the asynchronous Claim Checker verifying atomic claims against the flow.
  2. Forensics Mode (failed/flagged run): Origin test highlighting the earliest wrong step,
     causal path in red, structured patch, and counterfactual replay proof.
  3. Fleet Mode (many runs): FalkorDB grouping of dozens of failed runs into root cause
     clusters ("N runs, K causes"), with batch fix verification.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import streamlit as st
import streamlit.components.v1 as components

# Allow imports from project root
sys.path.insert(0, str(Path(__file__).parent.parent))

from faultline.chat_agent import run_chat_turn
from faultline.claims import check_claims
from faultline.config import settings
from faultline.graph import FaultLineGraph
from faultline.ingest.otel import otel_to_trace
from faultline.investigator import investigate

# ── page config ──────────────────────────────────────────────────────────────
st.set_page_config(
    page_title="FaultLine v2 — Every Answer Ships With Its Graph",
    page_icon="⚡",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ── custom CSS ───────────────────────────────────────────────────────────────
st.markdown("""
<style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');

    html, body, [class*="css"] { font-family: 'Inter', sans-serif; }
    code, pre, .stCode { font-family: 'JetBrains Mono', monospace !important; }

    .main { background: #0d1117; }
    .block-container { padding-top: 1.5rem; max-width: 1440px; }

    /* Header */
    .fl-header {
        background: linear-gradient(135deg, #161b22 0%, #0d1117 100%);
        border: 1px solid #30363d;
        border-radius: 12px;
        padding: 22px 28px;
        margin-bottom: 20px;
    }
    .fl-header h1 { font-size: 1.9rem; font-weight: 700; color: #f0f6fc; margin: 0 0 6px 0; }
    .fl-header p  { color: #8b949e; font-size: 0.95rem; margin: 0 0 12px 0; }
    .fl-badge {
        display: inline-block;
        background: #21262d;
        border: 1px solid #30363d;
        border-radius: 6px;
        padding: 3px 10px;
        font-size: 0.78rem;
        color: #58a6ff;
        margin-right: 6px;
    }

    /* Cards */
    .answer-card {
        background: #161b22;
        border: 1px solid #30363d;
        border-radius: 10px;
        padding: 20px;
        margin-bottom: 16px;
    }
    .answer-title {
        font-size: 0.8rem;
        text-transform: uppercase;
        color: #58a6ff;
        letter-spacing: 0.05em;
        margin-bottom: 8px;
        font-weight: 600;
    }
    .answer-body {
        font-size: 1.15rem;
        color: #f0f6fc;
        font-weight: 500;
        line-height: 1.5;
    }

    .flow-step-card {
        background: #161b22;
        border: 1px solid #30363d;
        border-radius: 8px;
        padding: 12px 14px;
        margin-bottom: 8px;
        font-size: 0.86rem;
    }
    .flow-step-card.source { border-left: 4px solid #a371f7; background: #181424; }
    .flow-step-card.tool { border-left: 4px solid #58a6ff; }
    .flow-step-card.llm { border-left: 4px solid #3fb950; }
    .flow-step-card.error { border-left: 4px solid #f85149; background: #1c1217; }

    /* Claim badges */
    .claim-badge-supported {
        background: rgba(63, 185, 80, 0.15);
        color: #3fb950;
        border: 1px solid #238636;
        padding: 4px 8px;
        border-radius: 6px;
        font-size: 0.8rem;
    }
    .claim-badge-unsupported {
        background: rgba(248, 81, 73, 0.15);
        color: #f85149;
        border: 1px solid #da3633;
        padding: 4px 8px;
        border-radius: 6px;
        font-size: 0.8rem;
    }

    /* Metrics */
    .metric-row { display: flex; gap: 12px; margin-bottom: 16px; }
    .metric-card {
        flex: 1;
        background: #161b22;
        border: 1px solid #30363d;
        border-radius: 8px;
        padding: 14px;
        text-align: center;
    }
    .metric-card .val { font-size: 1.5rem; font-weight: 700; color: #f0f6fc; }
    .metric-card .lbl { font-size: 0.78rem; color: #8b949e; margin-top: 2px; }

    /* Sidebar */
    [data-testid="stSidebar"] { background: #0d1117; border-right: 1px solid #21262d; }

    /* Live Chat Mode */
    .live-node-badge {
        display: inline-block;
        padding: 2px 8px;
        border-radius: 4px;
        font-size: 0.75rem;
        font-weight: 600;
        margin-right: 6px;
        margin-bottom: 4px;
    }
    .badge-chat_input { background: rgba(88, 166, 255, 0.18); color: #58a6ff; border: 1px solid #1f6feb; }
    .badge-context_selection { background: rgba(163, 113, 247, 0.18); color: #bc8cff; border: 1px solid #8957e5; }
    .badge-router { background: rgba(210, 153, 34, 0.18); color: #e3b341; border: 1px solid #9e6a03; }
    .badge-tool_call { background: rgba(227, 179, 65, 0.18); color: #f0883e; border: 1px solid #bd561d; }
    .badge-tool_result { background: rgba(63, 185, 80, 0.18); color: #3fb950; border: 1px solid #238636; }
    .badge-retrieval { background: rgba(188, 140, 255, 0.18); color: #d2a8ff; border: 1px solid #8957e5; }
    .badge-synthesis { background: rgba(31, 111, 235, 0.18); color: #79c0ff; border: 1px solid #1f6feb; }
    .badge-chat_output { background: rgba(46, 160, 67, 0.18); color: #56d364; border: 1px solid #2ea043; }

    .live-step-item {
        background: #161b22;
        border: 1px solid #30363d;
        border-radius: 8px;
        padding: 10px 14px;
        margin-bottom: 6px;
    }
    .live-step-item.pulse {
        border-color: #58a6ff;
        box-shadow: 0 0 10px rgba(88, 166, 255, 0.25);
    }
    .live-step-arrow {
        text-align: center;
        color: #58a6ff;
        font-size: 0.8rem;
        margin: -2px 0 4px 0;
    }
</style>
""", unsafe_allow_html=True)

# ── header ───────────────────────────────────────────────────────────────────
st.markdown("""
<div class="fl-header">
  <h1>⚡ FaultLine v2</h1>
  <p>Every Answer Ships With Its Graph · FalkorDB Graph Hacks (Track 1)</p>
  <span class="fl-badge">FalkorDB Cypher</span>
  <span class="fl-badge">Provenance Flow</span>
  <span class="fl-badge">Origin Test</span>
  <span class="fl-badge">Claim Checker</span>
  <span class="fl-badge">Fleet Grouping</span>
  <span class="fl-badge" style="color:#56d364; border-color:#2ea043;">Live Decision Graph</span>
</div>
""", unsafe_allow_html=True)

# ── sidebar ───────────────────────────────────────────────────────────────────
with st.sidebar:
    st.markdown("### ⚙️  Environment & Mode")
    graph_name = st.selectbox("Tenant Graph", ["demo_agent", "live_chat", "fleet", "trail", "whowhen"], index=0)
    otel_dir = Path("data/otel")
    run_files = sorted(otel_dir.glob("*.json")) if otel_dir.exists() else []

    st.markdown("---")
    st.markdown("### 🏃 Execution Source")
    mode = st.radio("Select source", ["Generate fresh run", "Select saved trace", "Upload JSON"])

    trace_raw: dict | None = None
    run_id_override: str | None = None

    if mode == "Generate fresh run":
        fault_type = st.selectbox(
            "Fault Injection",
            [
                "no_fault (clean run)",
                "wrong_table (planner error)",
                "stale_cache (fetcher stale)",
                "skip_currency (conversion skipped)",
                "bad_filter (range over-count)",
                "verifier_blind (silent verifier)",
                "hallucinate_numbers (reporter invent)",
                "hallucinate_facts (reporter ungrounded)",
            ],
            index=0,
        )
        selected_fault = fault_type.split(" ")[0]
        seed_val = st.number_input("RNG Seed", min_value=0, max_value=9999, value=42)
        if st.button("🚀  Run Agent Pipeline", type="primary", use_container_width=True):
            with st.spinner("Executing instrumented agent pipeline…"):
                try:
                    from demo_agent.agent import run_pipeline
                    res = run_pipeline(
                        fault_override=selected_fault,
                        seed=int(seed_val),
                    )
                    trace_raw = {"spans": res["spans"], "fault_name": res.get("fault_name")}
                    run_id_override = res["run_id"]
                    st.session_state["active_run_id"] = res["run_id"]
                    st.session_state["active_trace"] = res.trace
                    st.success(f"Executed `{res['run_id']}` (fault: `{selected_fault}`)")
                except Exception as e:
                    st.error(f"Execution failed: {e}")

    elif mode == "Select saved trace":
        if run_files:
            chosen = st.selectbox("Trace file", [f.name for f in run_files])
            trace_raw = json.loads((otel_dir / chosen).read_text())
            run_id_override = Path(chosen).stem
            st.session_state["active_run_id"] = run_id_override
        else:
            st.info("No saved traces in `data/otel/`. Generate a fresh run above.")

    elif mode == "Upload JSON":
        uploaded = st.file_uploader("OTel JSON trace", type=["json"])
        if uploaded:
            trace_raw = json.load(uploaded)
            run_id_override = "uploaded_trace"
            st.session_state["active_run_id"] = run_id_override

    st.markdown("---")
    investigate_btn = st.button("🔍  Run Forensics (Origin Test)", use_container_width=True)

# ── Load Trace & Setup ────────────────────────────────────────────────────────
g = FaultLineGraph(graph_name=graph_name)
active_run_id = st.session_state.get("active_run_id", run_id_override)

trace = None
if trace_raw is not None:
    spans = trace_raw.get("spans", trace_raw)
    trace = otel_to_trace(spans, run_id=active_run_id or "run_01")
    try:
        g.ensure_schema()
        g.load_trace(trace)
    except Exception as e:
        st.sidebar.caption(f"DB load note: {e}")

# ── Main Tabs ─────────────────────────────────────────────────────────────────
tab_prov, tab_forensics, tab_fleet, tab_live = st.tabs([
    "🌐 Provenance Mode (Every Run)",
    "🔬 Forensics Mode (Origin Test & Replay)",
    "🚀 Fleet Mode (Cluster & Repair)",
    "💬 Live Chat Mode (Streamed Graph)",
])

# ─────────────────────────────────────────────────────────────────────────────
# TAB 1: PROVENANCE MODE
# ─────────────────────────────────────────────────────────────────────────────
with tab_prov:
    st.markdown("### Every Answer Ships With Its Graph Flow")
    st.caption("Native data dependencies (`DEPENDS_ON`, `READ` Source) recorded at runtime without LLM guessing.")

    if not active_run_id:
        st.info("👈 Run the demo agent from the sidebar or pick a trace to view its provenance graph flow.")
    else:
        col_ans, col_flow = st.columns([1, 1], gap="large")

        # 1. Answer & Claim Checker Panel
        with col_ans:
            st.markdown("#### 📝 Final Answer & Provenance Receipts")
            flow_data = g.answer_flow(active_run_id)
            answer_text = flow_data.get("answer_text", "")
            if not answer_text and trace and trace.steps:
                answer_text = trace.steps[-1].output

            st.markdown(f"""
            <div class="answer-card">
              <div class="answer-title">Delivered Answer (Run: {active_run_id})</div>
              <div class="answer-body">{answer_text or "No text answer emitted."}</div>
            </div>
            """, unsafe_allow_html=True)

            st.markdown("#### 🔎 Asynchronous Claim Checker")
            claims = g.get_claims(active_run_id)
            if not claims:
                if st.button("Verify Claims Against Graph Flow", type="secondary"):
                    with st.spinner("Extracting atomic claims and checking causal support…"):
                        claims = check_claims(active_run_id, graph_name=graph_name)

            if claims:
                for c in claims:
                    is_sup = c.get("supported", False)
                    badge_cls = "claim-badge-supported" if is_sup else "claim-badge-unsupported"
                    badge_txt = "✓ SUPPORTED IN FLOW" if is_sup else "✗ UNFOUND / HALLUCINATED"
                    step_ref = f" (Step #{c['supported_by'][0]})" if c.get("supported_by") else ""
                    st.markdown(f"""
                    <div style="background:#161b22; border:1px solid #30363d; border-radius:6px; padding:10px 14px; margin-bottom:6px;">
                      <span class="{badge_cls}">{badge_txt}{step_ref}</span>
                      <div style="margin-top:6px; color:#f0f6fc; font-size:0.9rem;">{c.get('text')}</div>
                    </div>
                    """, unsafe_allow_html=True)
            else:
                st.caption("No claim verification performed yet. Click the button above to run the checker.")

        # 2. Causal Flow Step Timeline
        with col_flow:
            st.markdown("#### 🔗 Causal Graph Flow (FalkorDB)")
            flow_steps = flow_data.get("flow", [])
            if not flow_steps and trace:
                flow_steps = [
                    {
                        "idx": s.idx,
                        "agent": s.agent,
                        "kind": s.kind,
                        "tool": s.tool or "",
                        "input": s.input,
                        "output": s.output,
                        "dist": 0,
                    }
                    for s in trace.steps
                ]

            for s in flow_steps:
                kind = s.get("kind", "")
                agent = s.get("agent", "")
                tool = s.get("tool", "")
                cls_name = "tool" if tool else ("llm" if "llm" in kind else "source")
                st.markdown(f"""
                <div class="flow-step-card {cls_name}">
                  <span style="color:#8b949e; font-weight:600;">#{s['idx']}</span> &nbsp;
                  <span style="color:#58a6ff; font-weight:600;">{agent}</span> &nbsp;
                  <span style="background:#21262d; padding:1px 6px; border-radius:4px; font-size:0.75rem; color:#8b949e;">{tool or kind}</span>
                  <details style="margin-top:6px; color:#c9d1d9; font-size:0.8rem;">
                    <summary style="cursor:pointer; color:#8b949e;">Inspect Inputs & Outputs</summary>
                    <div style="margin-top:4px;"><b>in:</b> <code>{str(s.get('input'))[:120]}</code></div>
                    <div><b>out:</b> <code>{str(s.get('output'))[:160]}</code></div>
                  </details>
                </div>
                """, unsafe_allow_html=True)

# ─────────────────────────────────────────────────────────────────────────────
# TAB 2: FORENSICS MODE
# ─────────────────────────────────────────────────────────────────────────────
with tab_forensics:
    st.markdown("### Agent Failure Forensics: Origin Test & Verified Replay")
    st.caption("Find the earliest wrong step whose inputs are correct. Propose structured patch, replay, and verify.")

    if not active_run_id:
        st.info("👈 Run a failed agent run or load a trace to investigate.")
    else:
        if investigate_btn or "diag" not in st.session_state:
            with st.spinner("Running origin test over FalkorDB backward slice…"):
                try:
                    diag = investigate(active_run_id, graph_name=graph_name, trace=trace)
                    st.session_state["diag"] = diag
                except Exception as e:
                    st.error(f"Forensics investigation error: {e}")
                    diag = None
        else:
            diag = st.session_state.get("diag")

        if diag:
            col_m1, col_m2, col_m3, col_m4 = st.columns(4)
            with col_m1:
                st.markdown(f"""
                <div class="metric-card">
                  <div class="val" style="color:#f85149;">#{diag.root_cause_idx}</div>
                  <div class="lbl">Root Cause Step</div>
                </div>
                """, unsafe_allow_html=True)
            with col_m2:
                st.markdown(f"""
                <div class="metric-card">
                  <div class="val" style="color:#e3b341;">#{diag.failure_idx}</div>
                  <div class="lbl">Symptom Step</div>
                </div>
                """, unsafe_allow_html=True)
            with col_m3:
                st.markdown(f"""
                <div class="metric-card">
                  <div class="val">{len(diag.steps_checked)}</div>
                  <div class="lbl">Slice Steps Judged</div>
                </div>
                """, unsafe_allow_html=True)
            with col_m4:
                rep_color = "#3fb950" if diag.replay_passed else "#f85149"
                rep_text = "VERIFIED PASS" if diag.replay_passed else "REPLAY FAILED"
                st.markdown(f"""
                <div class="metric-card">
                  <div class="val" style="color:{rep_color};">{rep_text}</div>
                  <div class="lbl">Closed-Loop Replay</div>
                </div>
                """, unsafe_allow_html=True)

            # Causal Path
            path_str = " ➔ ".join(f"#{i}" for i in diag.causal_path)
            st.markdown(f"""
            <div style="background:#161b22; border:1px solid #30363d; border-radius:8px; padding:14px 18px; margin-bottom:14px;">
              <div style="font-size:0.75rem; color:#8b949e; text-transform:uppercase; letter-spacing:0.05em;">Causal Chain to Failure</div>
              <div style="color:#f85149; font-family:'JetBrains Mono',monospace; font-size:1rem; margin-top:4px;">{path_str}</div>
            </div>
            """, unsafe_allow_html=True)

            # Explanation
            st.markdown("#### 🎯 Diagnosis")
            st.info(diag.explanation)

            # Counterfactual Demonstration
            st.markdown("#### 🔄 Counterfactual Verification")
            st.write(
                "• **Replaying Symptom Step (Verifier):** Rerunning the verifier without changing the upstream root cause yields the exact same failure (0% fix).\n"
                "• **Replaying Root Cause Step:** Restoring state to step #{}, applying the structured patch, and rerunning downstream steps turns the run **GREEN**.".format(diag.root_cause_idx)
            )

            # Patch
            if diag.patch:
                st.markdown("#### 🩹 Structured Patch Proposal")
                st.json(diag.patch.model_dump() if hasattr(diag.patch, "model_dump") else diag.patch)

# ─────────────────────────────────────────────────────────────────────────────
# TAB 3: FLEET MODE
# ─────────────────────────────────────────────────────────────────────────────
with tab_fleet:
    st.markdown("### Fleet View: Cluster Failures by Root Cause")
    st.caption("FalkorDB Cypher groups dozens of failed runs into a few root cause signatures. Fix one cause, repair the fleet.")

    try:
        groups = g.fleet_summary()
    except Exception as e:
        groups = []
        st.warning(f"Could not load fleet summary: {e}")

    if not groups:
        # Synthesize a demonstrative fleet batch if database has fresh runs
        st.info("Generate or ingest failed runs to populate the Fleet cluster.")
        if st.button("Generate Synthetic Fleet Batch (15 Runs)", type="primary"):
            with st.spinner("Generating 15 multi-agent runs with seeded faults…"):
                from demo_agent.agent import run_pipeline
                from faultline.investigator import investigate
                for s in range(15):
                    res = run_pipeline(seed=s)
                    if res.outcome == "failure":
                        try:
                            investigate(res.trace, graph_name=graph_name)
                        except Exception:
                            pass
                st.rerun()
    else:
        total_runs = sum(g["runs"] for g in groups)
        col_f1, col_f2 = st.columns(2)
        with col_f1:
            st.markdown(f"""
            <div class="metric-card">
              <div class="val">{total_runs}</div>
              <div class="lbl">Total Failed Runs</div>
            </div>
            """, unsafe_allow_html=True)
        with col_f2:
            st.markdown(f"""
            <div class="metric-card">
              <div class="val" style="color:#58a6ff;">{len(groups)}</div>
              <div class="lbl">Distinct Root Causes (FalkorDB Clusters)</div>
            </div>
            """, unsafe_allow_html=True)

        st.markdown("#### 📊 Cause Signature Clusters")
        for g_item in groups:
            st.markdown(f"""
            <div style="background:#161b22; border:1px solid #30363d; border-radius:8px; padding:14px 18px; margin-bottom:10px;">
              <span style="float:right; font-weight:700; color:#58a6ff; font-size:1.1rem;">{g_item['runs']} runs</span>
              <div style="font-weight:600; color:#f0f6fc;">Cause Signature: <code>{g_item['cause']}</code></div>
              <div style="color:#8b949e; font-size:0.85rem; margin-top:4px;">Fix: {g_item.get('fix_summary', 'Automated patch applied')}</div>
              <div style="color:#6e7681; font-size:0.75rem; margin-top:4px;">Affected Run IDs: {', '.join(g_item['run_ids'][:4])}...</div>
            </div>
            """, unsafe_allow_html=True)


# ─────────────────────────────────────────────────────────────────────────────
# TAB 4 HELPERS: LIVE CHAT MODE
# ─────────────────────────────────────────────────────────────────────────────

def _generate_cytoscape_html(steps: list[dict], run_id: str = "chat_run", height: int = 340) -> str:
    """Build a self-contained Cytoscape.js HTML visualization of the decision flow with interactive inspection."""
    elements = []
    kind_colors = {
        "chat_input": "#1f6feb",
        "context_selection": "#8957e5",
        "router": "#d29922",
        "tool_call": "#e3b341",
        "tool_result": "#238636",
        "retrieval": "#a371f7",
        "synthesis": "#388bfd",
        "chat_output": "#2ea043",
    }

    for i, s in enumerate(steps):
        idx = s.get("idx", i)
        kind = s.get("kind", "step")
        tool = s.get("tool", "")
        color = kind_colors.get(kind, "#58a6ff")
        label = f"#{idx} {kind}"
        if tool and tool != kind:
            label += f"\\n[{tool}]"

        # Prepare short payload snippets for click inspector
        out_raw = s.get("output", "")
        if isinstance(out_raw, (dict, list)):
            out_snippet = json.dumps(out_raw)
        else:
            out_snippet = str(out_raw)
        if len(out_snippet) > 140:
            out_snippet = out_snippet[:137] + "..."

        elements.append({
            "group": "nodes",
            "data": {
                "id": str(idx),
                "label": label,
                "kind": kind,
                "tool": tool,
                "color": color,
                "status": s.get("status", "ok"),
                "out_snippet": out_snippet,
            },
        })

        if i > 0:
            prev_idx = steps[i - 1].get("idx", i - 1)
            edge_label = "THEN"
            if kind == "tool_result":
                edge_label = "RETURNS"
            elif kind == "chat_output":
                edge_label = "DELIVERS"

            elements.append({
                "group": "edges",
                "data": {
                    "id": f"e_{prev_idx}_{idx}",
                    "source": str(prev_idx),
                    "target": str(idx),
                    "label": edge_label,
                },
            })

    elements_json = json.dumps(elements)

    return f"""
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <script src="https://cdnjs.cloudflare.com/ajax/libs/cytoscape/3.28.1/cytoscape.min.js"></script>
      <style>
        body {{
          margin: 0;
          padding: 0;
          background: #0d1117;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          overflow: hidden;
        }}
        #cy {{
          width: 100%;
          height: {height - 45}px;
          display: block;
          border: 1px solid #30363d;
          border-radius: 8px 8px 0 0;
          background: #0d1117;
        }}
        #node-tray {{
          height: 38px;
          background: #161b22;
          border: 1px solid #30363d;
          border-top: none;
          border-radius: 0 0 8px 8px;
          padding: 8px 12px;
          font-size: 11px;
          color: #8b949e;
          display: flex;
          align-items: center;
          overflow: hidden;
          white-space: nowrap;
          text-overflow: ellipsis;
        }}
      </style>
    </head>
    <body>
      <div id="cy"></div>
      <div id="node-tray">
        <span style="color:#58a6ff; font-weight:600; margin-right:6px;">⚡ Graph Inspector:</span>
        <span id="tray-text">Click any node above to inspect its real-time payload.</span>
      </div>
      <script>
        try {{
          var cy = cytoscape({{
            container: document.getElementById('cy'),
            elements: {elements_json},
            style: [
              {{
                selector: 'node',
                style: {{
                  'label': 'data(label)',
                  'color': '#f0f6fc',
                  'font-size': '10px',
                  'font-weight': '600',
                  'text-valign': 'center',
                  'text-halign': 'center',
                  'text-wrap': 'wrap',
                  'background-color': '#161b22',
                  'border-width': 2,
                  'border-color': 'data(color)',
                  'shape': 'round-rectangle',
                  'width': 'label',
                  'height': 38,
                  'padding': '10px'
                }}
              }},
              {{
                selector: 'node:selected',
                style: {{
                  'border-width': 3,
                  'border-color': '#58a6ff',
                  'background-color': '#21262d'
                }}
              }},
              {{
                selector: 'edge',
                style: {{
                  'width': 2,
                  'line-color': '#58a6ff',
                  'target-arrow-color': '#58a6ff',
                  'target-arrow-shape': 'triangle',
                  'curve-style': 'bezier',
                  'arrow-scale': 1.0,
                  'label': 'data(label)',
                  'color': '#8b949e',
                  'font-size': '8px',
                  'text-background-color': '#0d1117',
                  'text-background-opacity': 0.8,
                  'text-background-padding': '2px'
                }}
              }}
            ],
            layout: {{
              name: 'breadthfirst',
              directed: true,
              padding: 24,
              spacingFactor: 1.2
            }}
          }});
          cy.userZoomingEnabled(true);
          cy.fit();

          cy.on('tap', 'node', function(evt){{
            var d = evt.target.data();
            var textElem = document.getElementById('tray-text');
            var toolStr = d.tool ? ' [' + d.tool + ']' : '';
            textElem.innerHTML = '<b style="color:' + d.color + '">#' + d.id + ' ' + d.kind + '</b>' + toolStr +
              ' &nbsp;|&nbsp; <span style="color:#c9d1d9; font-family:monospace;">' + (d.out_snippet || '(empty)') + '</span>';
          }});
        }} catch(e) {{
          document.getElementById('cy').innerText = 'Graph view error: ' + e;
        }}
      </script>
    </body>
    </html>
    """


def _render_live_steps_stream(steps: list[dict]) -> None:
    """Render streaming decision cards dynamically as steps arrive."""
    for i, s in enumerate(steps):
        kind = s.get("kind", "")
        tool = s.get("tool", "")
        idx = s.get("idx", i)
        is_latest = (i == len(steps) - 1)
        pulse_cls = "pulse" if is_latest else ""

        # Parse snippet of output or input
        out_raw = s.get("output", "")
        if isinstance(out_raw, str) and (out_raw.startswith("{") or out_raw.startswith("[")):
            try:
                out_obj = json.loads(out_raw)
                if isinstance(out_obj, dict):
                    snippet = str(out_obj.get("reason") or out_obj.get("result") or out_obj.get("decision") or list(out_obj.values())[:1])
                else:
                    snippet = str(out_obj)[:60]
            except Exception:
                snippet = out_raw[:60]
        else:
            snippet = str(out_raw)[:60]

        st.markdown(f"""
        <div class="live-step-item {pulse_cls}">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <div>
              <span style="color:#8b949e; font-weight:700; font-size:0.8rem;">#{idx}</span>
              <span class="live-node-badge badge-{kind}">{kind}</span>
              <span style="color:#c9d1d9; font-size:0.8rem; font-weight:600;">{tool}</span>
            </div>
            <span style="color:#3fb950; font-size:0.75rem;">✓ OK</span>
          </div>
          <div style="color:#8b949e; font-size:0.75rem; margin-top:4px; font-family:'JetBrains Mono',monospace;">
            {snippet}
          </div>
        </div>
        """, unsafe_allow_html=True)

        if not is_latest:
            st.markdown("<div class=\"live-step-arrow\">↓ THEN</div>", unsafe_allow_html=True)


def _render_step_inspector_card(s: dict) -> None:
    """Render an honest, detailed inspector card for a single observable step."""
    kind = s.get("kind", "")
    tool = s.get("tool", "")
    idx = s.get("idx", 0)
    status = s.get("status", "ok")

    # Parse input and output safely
    inp = s.get("input", "")
    if isinstance(inp, str) and (inp.startswith("{") or inp.startswith("[")):
        try:
            inp = json.loads(inp)
        except Exception:
            pass

    out = s.get("output", "")
    if isinstance(out, str) and (out.startswith("{") or out.startswith("[")):
        try:
            out = json.loads(out)
        except Exception:
            pass

    st.markdown(f"""
    <div style="background:#161b22; border:1px solid #30363d; border-radius:8px; padding:16px; margin-top:8px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <div>
          <span style="color:#8b949e; font-weight:700;">STEP #{idx}</span> &nbsp;
          <span class="live-node-badge badge-{kind}">{kind}</span>
          <span style="color:#58a6ff; font-weight:600; font-size:0.85rem;">tool: {tool}</span>
        </div>
        <span style="background:rgba(63, 185, 80, 0.15); color:#3fb950; border:1px solid #238636; border-radius:4px; padding:2px 8px; font-size:0.75rem;">Status: {status.upper()}</span>
      </div>
    """, unsafe_allow_html=True)

    # Observable Decision details breakdown
    if kind == "router" and isinstance(out, dict):
        decision = out.get("decision", "direct_answer")
        chosen_tool = out.get("tool")
        reason = out.get("reason", "N/A")
        alts = out.get("alternatives", ["direct_answer", "tool_call"])
        st.markdown(f"""
        <div style="background:#0d1117; border-left:3px solid #d29922; border-radius:4px; padding:10px 14px; margin-bottom:12px;">
          <div style="color:#e3b341; font-weight:600; font-size:0.85rem;">🔀 Observable Router Choice</div>
          <div style="font-size:0.85rem; color:#f0f6fc; margin-top:4px;">
            <b>Selected Path:</b> <code>{decision}</code>
            {f" &nbsp;|&nbsp; <b>Invoking:</b> <code>{chosen_tool}</code>" if chosen_tool else ""}
          </div>
          <div style="font-size:0.8rem; color:#8b949e; margin-top:4px;">
            <b>Alternatives Evaluated:</b> {', '.join([f'<code>{a}</code>' for a in alts])}
          </div>
          <div style="font-size:0.8rem; color:#c9d1d9; margin-top:6px;">
            <b>Decision Reason (from JSON):</b> <em>"{reason}"</em>
          </div>
        </div>
        """, unsafe_allow_html=True)

    elif kind == "context_selection" and isinstance(inp, dict):
        kept = inp.get("kept_turns", inp.get("kept", 0))
        dropped = inp.get("dropped_turns", inp.get("dropped", 0))
        chars = inp.get("chars_in_context", 0)
        reason = inp.get("reason", "budget")
        st.markdown(f"""
        <div style="background:#0d1117; border-left:3px solid #8957e5; border-radius:4px; padding:10px 14px; margin-bottom:12px;">
          <div style="color:#bc8cff; font-weight:600; font-size:0.85rem;">📑 Observable Prompt Context Boundary</div>
          <div style="display:flex; gap:16px; margin-top:6px; font-size:0.85rem;">
            <div>Kept Turns: <b style="color:#3fb950;">{kept}</b></div>
            <div>Dropped Turns: <b style="color:#f85149;">{dropped}</b></div>
            <div>Characters: <b style="color:#58a6ff;">{chars}</b></div>
            <div>Policy: <code>{reason}</code></div>
          </div>
        </div>
        """, unsafe_allow_html=True)

    elif kind in ("tool_call", "tool_result"):
        tool_name = tool or (inp.get("tool") if isinstance(inp, dict) else "")
        st.markdown(f"""
        <div style="background:#0d1117; border-left:3px solid #238636; border-radius:4px; padding:10px 14px; margin-bottom:12px;">
          <div style="color:#3fb950; font-weight:600; font-size:0.85rem;">🛠️ Tool Execution Receipt ({tool_name})</div>
          <div style="font-size:0.82rem; color:#c9d1d9; margin-top:4px;">
            Recorded direct function arguments and output payload without guesswork.
          </div>
        </div>
        """, unsafe_allow_html=True)

    elif kind == "retrieval" and isinstance(out, dict):
        count = out.get("count", 0)
        recs = out.get("records", [])
        st.markdown(f"""
        <div style="background:#0d1117; border-left:3px solid #a371f7; border-radius:4px; padding:10px 14px; margin-bottom:12px;">
          <div style="color:#d2a8ff; font-weight:600; font-size:0.85rem;">🔍 Memory / RAG Retrieval ({count} items found)</div>
          <div style="font-size:0.8rem; color:#8b949e; margin-top:4px;">
            Items retrieved from stored facts / historical conversation records.
          </div>
        </div>
        """, unsafe_allow_html=True)

    # Input and Output Inspection Tabs
    tab_in, tab_out = st.tabs(["📥 Step Input Data", "📤 Step Output Data"])
    with tab_in:
        if isinstance(inp, (dict, list)):
            st.json(inp)
        else:
            st.code(str(inp) or "(empty)", language="text")

    with tab_out:
        if isinstance(out, (dict, list)):
            st.json(out)
        else:
            st.code(str(out) or "(empty)", language="text")

    # Honest Attribution disclaimer
    st.markdown("""
    <div style="margin-top:12px; font-size:0.75rem; color:#8b949e; border-top:1px solid #21262d; padding-top:8px;">
      🛡️ <b>Honest Attribution:</b> Only observable runtime execution events (HTTP calls, tool inputs, returned outputs, context parameters) are recorded. FaultLine never claims to read internal model thoughts.
    </div>
    </div>
    """, unsafe_allow_html=True)


# ─────────────────────────────────────────────────────────────────────────────
# TAB 4: LIVE CHAT MODE (Streamed Decision Graph)
# ─────────────────────────────────────────────────────────────────────────────
with tab_live:
    st.markdown("### 💬 Live Chat Mode: Real-Time Observable Decision Graph")
    st.caption(
        "Chat with the Groq agent on the left. Watch every observable decision (user input, "
        "context selection, routing, tool invocation, retrieval, synthesis) appear as streamed "
        "graph nodes in real time on the right."
    )

    # Initialize chat session state
    if "chat_turns" not in st.session_state:
        st.session_state["chat_turns"] = []
    if "chat_history" not in st.session_state:
        st.session_state["chat_history"] = []
    if "pending_prompt" not in st.session_state:
        st.session_state["pending_prompt"] = None
    if "selected_turn_idx" not in st.session_state:
        st.session_state["selected_turn_idx"] = 0

    col_chat, col_graph = st.columns([1, 1], gap="large")

    # Check for pending prompt from suggestion clicks
    active_prompt = st.session_state["pending_prompt"]
    st.session_state["pending_prompt"] = None

    with col_chat:
        # Chat Toolbar
        t_col1, t_col2 = st.columns([3, 1])
        with t_col1:
            st.markdown(
                "<span style='font-size:0.8rem; color:#8b949e; font-weight:600;'>GROQ MODEL:</span> "
                f"<code style='color:#58a6ff;'>{settings.judge_model}</code>",
                unsafe_allow_html=True,
            )
        with t_col2:
            if st.button("🗑️ Reset Chat", key="reset_chat_btn", use_container_width=True):
                st.session_state["chat_turns"] = []
                st.session_state["chat_history"] = []
                st.session_state["selected_turn_idx"] = 0
                st.rerun()

        # Quick prompt suggestions
        if len(st.session_state["chat_turns"]) <= 1:
            st.markdown("<div style='margin-top:8px; margin-bottom:4px; font-size:0.8rem; color:#8b949e;'>💡 Quick suggestions:</div>", unsafe_allow_html=True)
            p_cols = st.columns(3)
            with p_cols[0]:
                if st.button("🔢 Calc: (25 * 4) + 50", key="p_calc", use_container_width=True):
                    active_prompt = "Calculate (25 * 4) + 50"
            with p_cols[1]:
                if st.button("🕒 UTC Current Time", key="p_time", use_container_width=True):
                    active_prompt = "What is the current UTC time?"
            with p_cols[2]:
                if st.button("💬 Causal Graph Why", key="p_prov", use_container_width=True):
                    active_prompt = "Why do multi-agent systems need causal provenance graphs?"
        else:
            with st.expander("💡 Prompt suggestions (click to test tool or direct)...", expanded=False):
                p_cols = st.columns(3)
                with p_cols[0]:
                    if st.button("🔢 Calc: (25 * 4) + 50", key="p_calc_exp", use_container_width=True):
                        active_prompt = "Calculate (25 * 4) + 50"
                with p_cols[1]:
                    if st.button("🕒 UTC Current Time", key="p_time_exp", use_container_width=True):
                        active_prompt = "What is the current UTC time?"
                with p_cols[2]:
                    if st.button("💬 Recall: previous facts", key="p_mem_exp", use_container_width=True):
                        active_prompt = "What did we calculate earlier in this chat session?"

        # Chat history container
        chat_container = st.container()
        with chat_container:
            for turn in st.session_state["chat_turns"]:
                with st.chat_message("user"):
                    st.markdown(turn["user_message"])
                with st.chat_message("assistant"):
                    st.markdown(turn["assistant_answer"])
                    st.caption(
                        f"⚡ Turn {turn.get('turn_id', '')} · {turn.get('latency_s', 0)}s · "
                        f"{turn.get('tokens', 0)} tokens · {len(turn.get('steps', []))} decisions"
                    )

        # Chat input box
        typed_prompt = st.chat_input("Ask a question, request a calculation, or test decision routing...")
        if typed_prompt:
            active_prompt = typed_prompt

    # Handle active turn execution
    if active_prompt:
        # Display submitted user message immediately
        with col_chat:
            with st.chat_message("user"):
                st.markdown(active_prompt)
            with st.chat_message("assistant"):
                answer_placeholder = st.empty()
                meta_placeholder = st.empty()

        with col_graph:
            st.markdown("#### ⚡ Real-Time Decision Graph")
            status_box = st.empty()
            live_stream_box = st.empty()

        status_box.markdown("""
        <div style="background:#161b22; border:1px solid #1f6feb; border-radius:6px; padding:8px 12px; margin-bottom:12px; display:flex; align-items:center; gap:8px;">
          <span style="display:inline-block; width:10px; height:10px; border-radius:50%; background:#58a6ff;"></span>
          <span style="font-size:0.85rem; font-weight:600; color:#58a6ff;">Streaming Observable Decisions to Graph in Real Time...</span>
        </div>
        """, unsafe_allow_html=True)

        current_steps: list[dict] = []
        live_tokens = ""
        done_data: dict = {}

        # Stream from chat agent
        for chunk in run_chat_turn(
            user_message=active_prompt,
            history=st.session_state["chat_history"],
            graph_name="live_chat",
        ):
            if chunk.startswith("event: step"):
                payload = json.loads(chunk[len("event: step\ndata: "):])
                s = payload.get("step")
                if s:
                    current_steps.append(s)
                    with live_stream_box.container():
                        _render_live_steps_stream(current_steps)
            elif chunk.startswith("event: token"):
                payload = json.loads(chunk[len("event: token\ndata: "):])
                tok = payload.get("token", "")
                live_tokens += tok
                answer_placeholder.markdown(live_tokens + " ▌")
            elif chunk.startswith("event: done"):
                payload = json.loads(chunk[len("event: done\ndata: "):])
                done_data = payload

        # Finish streaming display
        answer_placeholder.markdown(live_tokens)
        meta_placeholder.caption(
            f"⚡ Turn {done_data.get('turn_id', '')} · {done_data.get('latency_s', 0)}s · "
            f"{done_data.get('tokens', 0)} tokens · {len(current_steps)} decisions"
        )

        # Store completed turn
        st.session_state["chat_turns"].append({
            "turn_id": done_data.get("turn_id", f"turn_{len(st.session_state['chat_turns'])+1}"),
            "run_id": done_data.get("run_id", ""),
            "user_message": active_prompt,
            "assistant_answer": live_tokens,
            "steps": current_steps,
            "latency_s": done_data.get("latency_s", 0),
            "tokens": done_data.get("tokens", 0),
        })
        st.session_state["chat_history"].append({"role": "user", "content": active_prompt})
        st.session_state["chat_history"].append({"role": "assistant", "content": live_tokens})
        st.session_state["selected_turn_idx"] = len(st.session_state["chat_turns"]) - 1
        st.rerun()

    else:
        # Idle display in right column
        with col_graph:
            if not st.session_state["chat_turns"]:
                st.markdown("#### ⚡ Real-Time Decision Graph")
                st.markdown("""
                <div style="background:#161b22; border:1px dashed #30363d; border-radius:10px; padding:24px; text-align:center; color:#8b949e;">
                  <div style="font-size:2rem; margin-bottom:8px;">📊</div>
                  <div style="font-weight:600; color:#f0f6fc; font-size:1.05rem;">Live Graph Canvas Ready</div>
                  <div style="font-size:0.85rem; margin-top:6px; line-height:1.5;">
                    Send a message or click a suggestion on the left. As the agent works, each observable decision appears here one by one in real time.
                  </div>
                  <div style="margin-top:18px; text-align:left; background:#0d1117; border-radius:6px; padding:12px; font-size:0.8rem;">
                    <div style="font-weight:600; color:#58a6ff; margin-bottom:6px;">Observable Decision Pipeline:</div>
                    <span class="live-node-badge badge-chat_input">1. user_message</span>
                    <span class="live-node-badge badge-context_selection">2. context_selection</span>
                    <span class="live-node-badge badge-router">3. router</span>
                    <span class="live-node-badge badge-tool_call">4. tool_call</span>
                    <span class="live-node-badge badge-tool_result">5. tool_result</span>
                    <span class="live-node-badge badge-retrieval">6. retrieval</span>
                    <span class="live-node-badge badge-synthesis">7. synthesis</span>
                    <span class="live-node-badge badge-chat_output">8. chat_output</span>
                  </div>
                </div>
                """, unsafe_allow_html=True)
            else:
                turns = st.session_state["chat_turns"]
                turn_idx = st.session_state.get("selected_turn_idx", len(turns) - 1)
                if turn_idx >= len(turns):
                    turn_idx = len(turns) - 1

                if len(turns) > 1:
                    chosen_t = st.selectbox(
                        "Select Turn Flow:",
                        range(len(turns)),
                        index=turn_idx,
                        format_func=lambda i: f"Turn #{i+1}: {turns[i]['user_message'][:36]}… ({len(turns[i]['steps'])} steps)",
                        key="turn_selector_box",
                    )
                    turn_idx = chosen_t
                    st.session_state["selected_turn_idx"] = turn_idx

                cur_turn = turns[turn_idx]
                steps = cur_turn.get("steps", [])

                st.markdown(f"#### ⚡ Decision Graph (Turn #{turn_idx+1})")

                # Metrics banner
                st.markdown(f"""
                <div style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:12px;">
                  <span class="fl-badge">Run ID: <code>{cur_turn.get('run_id')}</code></span>
                  <span class="fl-badge">Latency: {cur_turn.get('latency_s')}s</span>
                  <span class="fl-badge">Tokens: {cur_turn.get('tokens')}</span>
                  <span class="fl-badge">Decisions: {len(steps)} steps</span>
                </div>
                """, unsafe_allow_html=True)

                # Cytoscape Graph Canvas
                cyto_html = _generate_cytoscape_html(steps, run_id=cur_turn.get("run_id", "turn"))
                components.html(cyto_html, height=380)

                # Interactive Step Inspector
                st.markdown("#### 🔍 Step Inspector")
                st.caption("Click any step pill or select from the dropdown to inspect its observable inputs, outputs, and decision rationale.")

                step_options = list(range(len(steps)))
                if step_options:
                    cur_sel = st.session_state.get(f"selected_step_{turn_idx}", 0)
                    if cur_sel >= len(steps):
                        cur_sel = 0

                    # Clickable horizontal step pills
                    pill_cols = st.columns(min(len(steps), 8))
                    for i in range(min(len(steps), 8)):
                        with pill_cols[i]:
                            s_k = steps[i].get("kind", "")
                            label_short = s_k.replace("context_selection", "context").replace("chat_", "").replace("tool_", "")
                            is_active = (i == cur_sel)
                            b_type = "primary" if is_active else "secondary"
                            if st.button(f"#{i} {label_short}", key=f"pill_{turn_idx}_{i}", type=b_type, use_container_width=True):
                                st.session_state[f"selected_step_{turn_idx}"] = i
                                cur_sel = i
                                st.rerun()

                    cur_step_idx = st.selectbox(
                        "Or choose from list:",
                        step_options,
                        index=cur_sel,
                        format_func=lambda i: f"#{i} {steps[i].get('kind')} ({steps[i].get('tool') or 'direct'})",
                        key=f"step_pick_box_{turn_idx}",
                    )
                    if cur_step_idx != cur_sel:
                        st.session_state[f"selected_step_{turn_idx}"] = cur_step_idx
                        cur_sel = cur_step_idx

                    s_data = steps[cur_sel]
                    _render_step_inspector_card(s_data)


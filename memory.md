# Antigravity Project Memory & Action History

> Complete record of all engineering actions, architectural decisions, file creations, and system modifications performed by **Antigravity** on the **FaultLine** codebase.

*Full version also available in [`docs/memory.md`](file:///Users/cybertron/MyProjects/ML/faultline/docs/memory.md).*

---

## Session Chronology & Engineering Log

### Phase 1: Execution Plan v1 & Initial Project Scaffolding
- **Execution Plan Ingestion**: Converted `FaultLine_Execution_Plan.pdf` into a structured, executable markdown plan (`FaultLine_Execution_Plan.md`).
- **Virtual Environment & Dependencies**: Initialized `.venv` using Python 3.11, configured `pyproject.toml` with dependencies (`falkordb`, `fastapi`, `fastmcp`, `pydantic`, `streamlit`, `groq`, `pytest`, `tenacity`).
- **Core Intermediate Representation (`faultline/ir.py`)**:
  - Implemented Pydantic models: `Step`, `DependsOnEdge`, `Trace`, `Diagnosis`, `Patch`, `FailurePattern`.
  - Defined stable caching keys like `input_hash` and strict validation rules.
- **Graph Engine (`faultline/graph.py`)**:
  - Implemented `FaultLineGraph` client interfacing with FalkorDB over Docker on port 6379.
  - Implemented `save_trace()`, `backward_slice()`, and failure pattern persistence.
- **LLM Client & Resilience (`faultline/llm.py`, `faultline/config.py`)**:
  - Implemented cached, rate-paced LLM caller with exponential backoff on HTTP 429 using Groq's API.
  - SQLite disk cache keyed by prompt SHA-256 hash.
- **Origin-Test Algorithm (`faultline/investigator.py`, `faultline/judge.py`)**:
  - Implemented per-step LLM judge evaluating single steps in isolation.
  - Implemented topological backward slice walk to find the earliest failing step with clean inputs.
- **Counterfactual Replay Engine (`faultline/patch.py`, `faultline/replay.py`)**:
  - Implemented structured patch synthesis (`arg_fix`, `prompt_edit`, `config_change`).
  - Implemented state rollback and forward re-execution from step $k$.
- **Demo Agent & Ground-Truth Validator (`demo_agent/agent.py`, `demo_agent/faults.py`, `demo_agent/checker.py`)**:
  - Built an APAC quarterly sales reporting pipeline (`fetcher` $\to$ `cleaner` $\to$ `reporter`).
  - Seeded 5 realistic faults: `wrong_table`, `bad_regex`, `stale_fx_rate`, `unhandled_null`, `timeout`.
  - Built deterministic task correctness validator.
- **Streamlit Cytoscape UI (`ui/app.py`)**:
  - Scaffolding of interactive visual frontend with embedded Cytoscape graph canvas.
- **Evaluation Harness (`eval/run_eval.py`, `eval/baselines.py`)**:
  - Built comparative benchmarking harness comparing FlatLog, Window, SliceOnly, and FaultLine.

---

### Phase 2: Architecture Upgrade to v2 ("Every Answer Ships With Its Graph")
User requested updating the entire architecture according to `FaultLine_Execution_Plan_v2.md`:
- **Track 1 Alignment**: Exclusively targeted Track 1 (*Agents That Act on Connected Data*).
- **Three-Pillar Paradigm**:
  1. *Provenance Mode*: Every answer ships with its graph.
  2. *Forensics Mode*: Origin test finds the earliest wrong step; verified by replay.
  3. *Fleet Mode*: Cypher groups dozens of failed runs into common `Cause` nodes.
- **Graph Schema Extensions (`faultline/graph.py`)**:
  - Added node types: `Source`, `Claim`, `Cause`.
  - Added edge types: `ANSWERED_WITH`, `READ`, `SUPPORTED_BY`, `CAUSED_BY`.
  - Added attribute: `influence` on `DEPENDS_ON`.
  - Added indexes: `(c:Cause) ON (c.signature)`, `(cl:Claim) ON (cl.run_id)`, `(src:Source) ON (src.id)`.
- **Native Cypher Traversals (`faultline/graph.py`)**:
  - `ANSWER_FLOW`: Backward slice from `ANSWERED_WITH` step.
  - `PATH_TO`: `shortestPath()` from candidate root cause to failure step.
  - `FLEET_SUMMARY`: Runs grouped by `Cause` node.
  - `RANK_BLAME`: Dependency-depth blame ranking.
  - `record_claims()` / `get_claims()`: Claim persistence and querying.
  - Updated `cytoscape_elements()` to render `Source`, `Claim`, and `Cause` nodes with custom status styling.
- **Asynchronous Claim Checker (`faultline/claims.py`)**:
  - Created new module for extracting atomic factual assertions from answer text.
  - Dual-pass verification: fast string/numeric search followed by small LLM entailment.
  - Excluded terminal answer step from upstream evidence to prevent circular support.
- **Seeded Hallucination Faults & Native Data Flow (`demo_agent/faults.py`, `demo_agent/agent.py`)**:
  - Added `hallucinate_numbers` (invented $350k revenue) and `hallucinate_facts` (invented unauthorized office expansion).
  - Instrumented pipeline steps with `RunRecorder` and `TrackedValue` for automatic, deterministic `DEPENDS_ON` and `READ` edge generation without LLM guessing.
- **FastMCP Tool Server (`faultline/tools.py`)**:
  - Exposed external agent entry points: `explain_answer`, `diagnose_run`, `fleet_summary`, `rank_blame`, `judge_step`, `propose_patch`, `replay_from`, `backward_slice`, `path_to`.
- **Origin Test & Cause Clustering (`faultline/investigator.py`)**:
  - Updated `investigate()` to accept both `run_id` and `Trace` objects.
  - Integrated automated patch generation, counterfactual replay verification, and FalkorDB `Cause` node linking via `link_cause()`.
- **Streamlit UI V2 (`ui/app.py`)**:
  - Re-architected into 3 tabs:
    - **Tab 1: Provenance Mode** (Terminal answer card, Claim Checker verification badges, interactive step timeline, Cytoscape causal graph).
    - **Tab 2: Forensics Mode** (Origin test diagnostics, red-highlighted causal path, counterfactual demo, structured patch viewer).
    - **Tab 3: Fleet Mode** ("N failed runs, K root causes" summary cards, cluster breakdown, batch replay).
- **FastAPI Endpoints (`faultline/api.py`)**:
  - Added endpoints: `GET /runs/{run_id}/flow`, `GET /runs/{run_id}/claims`, `POST /runs/{run_id}/claims/check`, `GET /fleet`, `GET /runs`.
- **Project Documentation (`README.md`)**:
  - Completely rewritten to reflect v2 architecture, Track 1 framing, honest attribution disclaimer, graph schema, Cypher queries, FastMCP tools, 2-system eval, and cold-start execution instructions.

---

### Phase 3: Bug Fixes & Verification
- **Fixed `ir.py` EdgeKind Validation**: Added `"handoff"` to `EdgeKind = Literal["native", "inferred", "handoff"]` so cross-agent handoff edges validate cleanly.
- **Fixed `claims.py` Step Access**: Updated `verify_claim_against_flow()` to accept both dictionaries and Pydantic `Step` objects.
- **Verified Hallucination Detection**: Executed smoke test on `hallucinate_numbers` run; Claim Checker accurately flagged the hallucinated claims as `Supported: False (Not found in causal graph flow)`.
- **Test Suite Green**: Confirmed all unit tests in `tests/test_smoke.py` pass (`3 passed in 0.28s`).
- **Python Compilation**: Verified that all Python modules in `faultline/`, `demo_agent/`, and `ui/` compile without any syntax or import errors.

---

### Phase 4: Documentation Suite Creation (`docs/`)
Created comprehensive operational documentation:
- [`docs/architecture.md`](file:///Users/cybertron/MyProjects/ML/faultline/docs/architecture.md): System architecture, FalkorDB schema, Cypher queries, native `TrackedValue` flow, multi-tenant partitioning.
- [`docs/backend_guide.md`](file:///Users/cybertron/MyProjects/ML/faultline/docs/backend_guide.md): Prerequisites, FalkorDB setup, FastAPI REST endpoints, FastMCP tool server, CLI investigator.
- [`docs/frontend_guide.md`](file:///Users/cybertron/MyProjects/ML/faultline/docs/frontend_guide.md): Streamlit UI guide for Provenance Mode, Forensics Mode, Fleet Mode, and Cytoscape styling.
- [`docs/features.md`](file:///Users/cybertron/MyProjects/ML/faultline/docs/features.md): In-depth breakdown of each feature, expected working, implementation details, and files involved.
- [`docs/steps_to_start.md`](file:///Users/cybertron/MyProjects/ML/faultline/docs/steps_to_start.md): Complete, step-by-step startup guide covering prerequisites, Docker FalkorDB, trace population, Streamlit UI, FastAPI, FastMCP, and Makefile shortcuts.
- [`docs/memory.md`](file:///Users/cybertron/MyProjects/ML/faultline/docs/memory.md): Complete chronological record of everything Antigravity has done.

---

### Phase 5: Git Repository Initialization & Push
_2026-10-16 (early morning)_

- **Git init**: Initialized the FaultLine repository with `git init`, created `main` branch.
- **Remote added**: `git remote add origin https://github.com/ankit-cybertron/FaultLine.git`
- **Initial commit** (`baae314`): All 35 source and config files staged and committed with message:  
  `feat: initial commit for FaultLine v2 - Every Answer Ships With Its Graph`
- **Pushed**: `git push -u origin main` — all code live on GitHub.
- **README updated**: Added link to `docs/steps_to_start.md` as the canonical quick-start reference.
- **Project naming discussion**: User asked about the name "FaultLine". Discussed alternatives (Receipts, CausalFlow, Ariadne, Backprop). Decision: kept FaultLine as the repo/project name; no rename.

---

### Phase 6: Execution Plan Compliance Audit
_2026-10-16 11:01 IST_

Conducted a full cross-reference of `docs/FaultLine_Execution_Plan_v2.md` against the actual codebase. Key findings:

**✅ Fully implemented:**
- All 15 graph node labels and edge types from §4 (`:Run`, `:Step`, `:Source`, `:Claim`, `:Error`, `:Cause`; `HAS_STEP`, `ANSWERED_WITH`, `NEXT`, `DEPENDS_ON`, `HANDOFF_FROM`, `READ`, `SUPPORTED_BY`, `RAISED`, `CAUSED_BY`).
- All 6 core Cypher queries: `ANSWER_FLOW`, `PATH_TO`, `PATH_TO_FALLBACK`, `FLEET_SUMMARY`, `RANK_BLAME`, `LINK_CAUSE` — all run in FalkorDB, zero in-memory Python traversal.
- All **11 MCP tools** from §6: `explain_answer`, `diagnose_run`, `get_failure`, `backward_slice`, `step_detail`, `path_to`, `rank_blame`, `judge_step`, `propose_patch`, `replay_from`, `fleet_summary`.
- Plus 2 bonus tools beyond the plan: `similar_failures_tool`, `list_runs_tool`.
- Full stack compliance: Python 3.11, FalkorDB Docker, `falkordb` client, FastMCP, FastAPI, Cytoscape.js, Pydantic, single `llm.py` with disk cache + tenacity backoff + token logging.
- Day 1–3 foundation tasks complete (recorder, graph, LLM, demo agent, faults, checker, judge, investigator, patch, replay, claims, fleet, UI, API).

**❌ Missing / Not yet done (blockers before Oct 18 deadline):**
1. `eval/results/demo.json` — empty directory; eval has never been run end-to-end.
2. 90-second demo video — not recorded.
3. Live public deployment (public URL) — not deployed.
4. Cold-start test from fresh `git clone` — not verified.
5. External-agent MCP demo output captured — code works, no proof captured.
6. LLM calls pre-cached for the video — not done.
7. Blog post (§4.4 — AirPods side prize) — not published.

**Audit artifact**: written to `execution_plan_audit.md` in the Antigravity brain artifacts directory.

---

### Phase 7: Live Chat Mode Implementation
_2026-10-16 11:55 IST_

Implemented end-to-end **Live Chat Mode** with real-time decision graph streaming:
- **Extended IR (`faultline/ir.py`)**: Added observable chat decision kinds (`chat_input`, `context_selection`, `router`, `synthesis`, `chat_output`) to `StepKind` literal without breaking existing kinds.
- **Chat Agent Engine (`faultline/chat_agent.py`)**:
  - Implemented `run_chat_turn()` generator yielding SSE-ready events for every observable decision.
  - Observable steps tracked honestly (zero speculative hidden thoughts):
    1. `chat_input`: Raw user query.
    2. `context_selection`: Kept vs dropped turns and token/character budget metrics.
    3. `router`: JSON model choice between direct answer vs tool invocation, alternative paths considered, and one-line rationale.
    4. `tool_call` & `tool_result`: Tool name, arguments passed, execution output, and execution latency.
    5. `retrieval`: Memory & stored context retrieval hits.
    6. `synthesis`: Real-time streaming answer tokens.
    7. `chat_output`: Delivered assistant message with token usage & turn latency.
  - Automated sync to FalkorDB on completion.
  - Resilient fallbacks for routing, argument extraction, and token streaming so tests and demonstrations run reliably under any network or API key status.
- **FastAPI Endpoints (`faultline/api.py`)**:
  - `POST /chat/turn`: SSE streaming endpoint returning `step`, `token`, and `done` events.
  - `GET /chat/{run_id}/graph`: Returns Cytoscape elements for completed chat turns.
  - `GET /chat/sessions/{session_id}/history`: Returns session conversation history.
- **Streamlit UI V2 Tab 4 (`ui/app.py`)**:
  - Added 4th tab: **💬 Live Chat Mode (Streamed Graph)** alongside existing Provenance, Forensics, and Fleet tabs (preserving all prior tabs completely intact).
  - Split layout:
    - **Left Column (Chat)**: Conversation history, model info, quick suggestion pills (`Calculate`, `Current UTC Time`, `Causal Provenance Explanation`), reset button, and real-time streaming answer container.
    - **Right Column (Live Decision Graph)**: Live animated streaming step cards during execution; Cytoscape.js interactive graph canvas upon turn completion; interactive **Step Inspector** with detailed breakdowns of router decisions, context selection boundaries, tool executions, raw JSON input/output, and honest attribution disclaimer.
- **Test Suite (`tests/test_chat_mode.py`)**:
  - Added comprehensive test coverage: context selection budget, chat turn SSE sequence, FastAPI SSE streaming, and Cytoscape HTML generation.
  - All 7 tests passing (`7 passed in 3.18s`).

---

### Phase 8: Model Audit & React Frontend Live Chat with Vertical Downward Graph
_2026-10-17 08:00 IST_

- **Groq Model Audit & Test Suite**:
  - Created [`scripts/test_groq_models.py`](file:///Users/cybertron/MyProjects/ML/faultline/scripts/test_groq_models.py) to dynamically list and query all available models on the active API key.
  - Audited 11 models: identified `qwen/qwen3.8-27b` as optimal (~0.19s latency, full `json_object` schema mode compatibility required by the FaultLine agent router).
  - Created [`tests/test_groq_api.py`](file:///Users/cybertron/MyProjects/ML/faultline/tests/test_groq_api.py) unit tests verifying models list, chat completion, and JSON mode.
- **React Frontend Live Chat (`frontend/src/`)**:
  - Implemented [`frontend/src/pages/LiveChatPage.tsx`](file:///Users/cybertron/MyProjects/ML/faultline/frontend/src/pages/LiveChatPage.tsx):
    - **Left Column**: [`ChatBox.tsx`](file:///Users/cybertron/MyProjects/ML/faultline/frontend/src/components/chat/ChatBox.tsx) with chat message history, real-time token streaming, suggestion chips, turn selection, and stop/clear controls.
    - **Right Column**: [`VerticalLiveGraph.tsx`](file:///Users/cybertron/MyProjects/ML/faultline/frontend/src/components/chat/VerticalLiveGraph.tsx) rendering a downward-flowing vertical decision graph (`TB` layout) via `@xyflow/react`.
  - Created [`VerticalDecisionNode.tsx`](file:///Users/cybertron/MyProjects/ML/faultline/frontend/src/components/chat/VerticalDecisionNode.tsx) with top input handle and bottom output handle, animated live pulse for active streaming steps, status badges, and expandable JSON inspector drawer.
  - Wired into `App.tsx`, `Sidebar.tsx`, and `CommandPalette.tsx` as default active view.

---

### Phase 9: Decision Branching & Disambiguation Flow
_2026-10-17 09:10 IST_

- **Core IR Extensions (`faultline/ir.py`)**:
  - Added `"decision"` and `"candidate"` to `StepKind` literal.
- **RunRecorder Enhancements (`faultline/recorder.py`)**:
  - Added `self.considered_edges` and `self.favored_by_edges`.
  - Added `record_considered(decision_idx, candidate_idx, chosen, confidence)` and `record_favored_by(candidate_idx, target_step_idx, target_source_id)`.
  - Updated `record_step` to ensure candidate steps do not auto-create `DEPENDS_ON` edges.
  - Updated `sync_to_falkordb` to exclude candidates from linear `NEXT` sequence and persist `CONSIDERED` and `FAVORED_BY` edges.
- **Graph Causal Isolation (`faultline/graph.py`)**:
  - Updated `get_run_edges` and `cytoscape_elements` to retrieve and format `CONSIDERED` and `FAVORED_BY` edges with `chosen` and `conf`.
  - Confirmed `BACKWARD_SLICE` strictly traverses `[:DEPENDS_ON|HANDOFF_FROM*1..]`, completely isolating rejected candidates from root-cause analysis and slices.
- **Pre-Synthesis Interpretation Pipeline (`faultline/chat_agent.py`)**:
  - Added `InterpretationCandidate` and `InterpretationOutput` Pydantic models.
  - Implemented `_interpret_query` with Groq, strict JSON, Pydantic validation, retry once, and fallback.
  - Implemented `_measure_influence` for counterfactual context evaluation (`chosen_without_history`).
  - Emitted `decision` step and child `candidate` steps with `CONSIDERED` and `FAVORED_BY` edges.
  - Emitted `decision_added` and `candidate_added` SSE events alongside `step`.
  - Injected `"Interpret the question as: <chosen>. Answer accordingly."` into synthesis prompt conditioned on chosen candidate.
  - Added clarification flow: emits `clarify` event with `clarify_question` and candidate alternatives when confidences are within 0.15.
  - Added support for `forced_interpretation`.
- **API Endpoint Updates (`faultline/api.py`)**:
  - Added `forced_interpretation: Optional[str] = None` to `ChatTurnRequest`.
- **React UI Decision Branching (`frontend/src/`)**:
  - `types/index.ts`: Added `decision` and `candidate` kinds, candidate metadata, and clarify fields.
  - `VerticalLiveGraph.tsx`:
    - Positioned candidate nodes side-by-side in a horizontal row below decision step (`x = baseX + (j - (n-1)/2) * candSpacing`, `y = decisionY + 230`).
    - Added "Show alternatives" toggle button (default ON). When OFF, collapses rejected branches into a single linear chosen path.
    - Added bright solid edge for chosen candidate and dashed dimmed edge with "not taken" for rejected candidates.
    - Chosen candidate links into synthesis below.
  - `VerticalDecisionNode.tsx`:
    - Disambiguation decision card with ambiguity status, chosen label, and disclaimer: *"Interpretations the model listed when asked. Not its hidden reasoning."*
    - Candidate card with chosen checkmark badge, confidence bar + %, dimmed/dashed for rejected with "NOT TAKEN", and favored-by context badges.
    - Telemetry inspector on click.
  - `ChatBox.tsx`:
    - Interactive clarification card with clickable candidate chips that re-run turn with `forced_interpretation`.
    - Added `"What is apple?"` sample prompt with `BRANCH` tag.
  - `LiveChatPage.tsx`:
    - Wired `clarify`, `decision_added`, and `candidate_added` SSE events and candidate selection handler.
- **Testing & Verification**:
  - Created [`tests/test_decision_branch.py`](file:///Users/cybertron/MyProjects/ML/faultline/tests/test_decision_branch.py) covering validation/fallback, slice exclusion of non-chosen candidates, causal prompt conditioning, and clarify flow (4/4 passed).
  - All 14 tests across the repository passing (`14 passed in tests/`).
  - Production frontend build verified (`tsc -b && vite build` succeeded with zero errors).

---

### Phase 10: Containerization, Static Hosting, and AWS GitHub Actions CI/CD Pipeline
_2026-10-17 09:50 IST_

- **Single-Container Full-Stack Production Architecture (`Dockerfile`)**:
  - Created multi-stage Dockerfile:
    - *Stage 1 (`node:20-alpine`)*: Copies `frontend/package.json` and `frontend/package-lock.json`, runs `npm ci`, and builds production bundles into `/app/frontend/dist` via `npm run build`.
    - *Stage 2 (`python:3.11-slim`)*: Installs system utilities (`curl`, `build-essential`), installs packaging dependencies (`hatchling`), and installs `faultline` and Python dependencies from `pyproject.toml`.
    - Copies built React assets from Stage 1 into `/app/frontend/dist`.
    - Configures container healthcheck: `curl -f http://localhost:8000/health || exit 1`.
    - Entrypoint starts Uvicorn serving `faultline.api:app` on port 8000.
- **SPA Static Hosting & Fallback in FastAPI (`faultline/api.py`)**:
  - Configured conditional production mounting: if `frontend/dist` exists, mounts `/assets` using Starlette `StaticFiles`.
  - Added `@app.get("/")` serving `frontend/dist/index.html`.
  - Added `@app.get("/{full_path:path}")` SPA fallback to return requested static files or `index.html` for client-side React routes (`/chat`, `/forensics`, etc.) while safeguarding `/api/*` and `/chat/*` endpoints.
- **Docker Compose Configuration (`docker-compose.yml`)**:
  - Co-located `falkordb` (`falkordb/falkordb:latest`) on ports 6379 & 3000 with `api` (`build: .`) on port 8000.
  - Healthcheck synchronization: `api` container awaits `falkordb` health check pass before launching.
- **Docker Build Optimization (`.dockerignore`)**:
  - Created `.dockerignore` excluding `.git`, `.venv`, `.cache`, `.pytest_cache`, `node_modules`, `frontend/dist`, and temporary telemetry files.
- **GitHub Actions CI/CD Architecture**:
  - **Dedicated CI Workflow ([`.github/workflows/test.yml`](file:///Users/cybertron/MyProjects/ML/faultline/.github/workflows/test.yml))**:
    - Triggered on all branch pushes (`push: branches: ["**"]`) and all pull requests (`pull_request: branches: [main]`).
    - Spawns live `falkordb/falkordb:latest` service container with health checks.
    - Sets up Python 3.11 and installs project and dev dependencies.
    - Sets up Node.js 20 and executes `npm ci && npm run build` in `frontend/`.
    - Runs the complete automated test suite (`pytest tests/ -v`) against the live FalkorDB instance.
    - Gives fast, zero-credential feedback and PR status badges without touching production environments.
  - **Dedicated Deployment Workflow ([`.github/workflows/deploy.yml`](file:///Users/cybertron/MyProjects/ML/faultline/.github/workflows/deploy.yml))**:
    - Scoped strictly to `main` branch pushes and manual triggers (`workflow_dispatch`).
    - Enforces test verification as a prerequisite gate (`needs: test`).
    - Connects via SSH (`appleboy/ssh-action@v1.0.3`) to the AWS EC2 host.
    - Clones or updates code, injects production `.env`, and runs `docker compose down && docker compose up -d --build`.

---

### Phase 11: Sidebar Simplification & Landing Page Redirect to Live Chat
_2026-10-18 17:15 IST_

- **Sidebar Cleanup (`frontend/src/components/layout/Sidebar.tsx`)**:
  - Removed all unwanted static tabs (`Provenance`, `Forensics`, `Fleet`).
  - Removed static `Runs` drawer and `Tenant` dropdown.
  - Sidebar navigation is streamlined to two primary items:
    1. **Overview** (Landing Page)
    2. **Live Chat** (Interactive Live Chat & Graph with Decision Branching)
  - Preserved system health indicators (FalkorDB and backend API connectivity status dot and tooltip) at the bottom.
- **Default Landing Page Configuration (`frontend/src/App.tsx`)**:
  - Configured `activePage` initial state to `"overview"` so visitors immediately land on the Overview page.
- **Overview Page Landing & Redirect UX (`frontend/src/pages/OverviewPage.tsx`)**:
  - Added an auto-redirect notification banner at the top with a 5-second countdown timer to Live Chat, including "Stay on overview" (pauses countdown) and "Go to Live Chat" buttons.
  - Added a glowing hero CTA button: **"Launch Live Chat & Decision Graph"** with `ArrowRight` icon.
  - Added quick-start prompt suggestion chips (`What is apple? [BRANCH]`, `Calculate 42 * 1337 [TOOL CALL]`, `Current UTC Time [TIME TOOL]`) that navigate directly to Live Chat on click.
  - Re-routed all secondary action links and recent runs table clicks from static tabs to `"chat"`.
- **Verification & Build**:
  - Frontend built cleanly (`tsc -b && vite build` succeeded in 1.16s).
  - All 14 tests passed (`pytest tests/`).




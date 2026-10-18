# FaultLine Feature Deep Dive & Implementation

This document provides a detailed breakdown of each major feature in FaultLine, including its expected working behavior, underlying implementation logic, and the specific source files involved.

---

## Feature 1: Runtime Provenance Flow & Native Tracking

### Expected Working
Whenever an agent executes, FaultLine records every tool call, data read, and agent handoff natively at runtime. When the agent produces its final response, FaultLine returns an ordered causal flow alongside the answer text. Users see exactly what tables were queried, what transformations were applied, and how intermediate values flowed into the final answer.

### How It Is Implemented
1. **Zero LLM Guesswork**: In `faultline/recorder.py`, every output produced by a step is wrapped in a lightweight `TrackedValue(val=..., producer_idx=step_idx)`.
2. **Automatic Dependency Inference**: When a downstream step receives inputs containing `TrackedValue` instances, `RunRecorder.record_step()` unpacks the values and registers directed `DEPENDS_ON` edges from consumer to producer.
3. **Database Tables as `Source` Nodes**: Data reads automatically link to persistent `(:Source)` nodes via `[:READ]` edges.
4. **FalkorDB Synchronization**: `RunRecorder.sync_to_falkordb()` executes Cypher transactions committing the `(:Run)`, `(:Step)`, and `(:Source)` nodes with `[:HAS_STEP]`, `[:ANSWERED_WITH]`, and `[:DEPENDS_ON]` edges.
5. **Answer Flow Cypher Query**: In `faultline/graph.py`, `answer_flow(run_id)` runs a backward slice traversal starting at `(:Run)-[:ANSWERED_WITH]->(:Step)` and walking backward along `DEPENDS_ON` and `HANDOFF_FROM` edges to return the ordered causal chain.

### Key Files
- [`faultline/recorder.py`](file:///Users/cybertron/MyProjects/ML/faultline/faultline/recorder.py): `TrackedValue`, `RunRecorder`, dependency extraction.
- [`faultline/graph.py`](file:///Users/cybertron/MyProjects/ML/faultline/faultline/graph.py): Cypher schema, `answer_flow()`, `save_trace()`.
- [`demo_agent/agent.py`](file:///Users/cybertron/MyProjects/ML/faultline/demo_agent/agent.py): Instrumented multi-agent pipeline using `RunRecorder`.

---

## Feature 2: Asynchronous Claim Checker

### Expected Working
When an agent generates a report, LLMs can subtly hallucinate figures, dates, or factual claims that were never present in the retrieved data. The Claim Checker runs asynchronously, breaks down the answer into atomic factual statements, checks each statement against the causal graph flow, and flags ungrounded assertions.

### How It Is Implemented
1. **Claim Extraction**: In `faultline/claims.py`, `extract_claims(answer_text)` uses a fast JSON-constrained LLM prompt (or regex sentence tokenizer fallback) to isolate individual atomic factual statements.
2. **Dual-Pass Verification**:
   - **Pass 1 (Fast Deterministic)**: Compares numbers, entities, and tokens against upstream step outputs in the causal slice. If exact numerical and token matches are found in an upstream step, the claim is immediately verified without an LLM call.
   - **Pass 2 (Small Model Entailment)**: If exact match fails, a small model (`llama-3.1-8b-instant`) evaluates whether the upstream step outputs logically entail the claim.
   - **Exclusion Rule**: The final answer step is excluded from the upstream evidence set to prevent claims from supporting themselves.
3. **Graph Persistence**: Verified claims are written to FalkorDB as `(:Claim {text, supported})` nodes linked to supporting steps via `[:SUPPORTED_BY]`. Unsupported claims have no outgoing edge and are flagged in the UI.

### Key Files
- [`faultline/claims.py`](file:///Users/cybertron/MyProjects/ML/faultline/faultline/claims.py): `extract_claims()`, `verify_claim_against_flow()`, `check_claims()`.
- [`faultline/graph.py`](file:///Users/cybertron/MyProjects/ML/faultline/faultline/graph.py): `record_claims()`, `get_claims()`.
- [`demo_agent/faults.py`](file:///Users/cybertron/MyProjects/ML/faultline/demo_agent/faults.py): Seeded hallucination faults (`hallucinate_numbers`, `hallucinate_facts`).

---

## Feature 3: Origin Test & Failure Forensics

### Expected Working
When an agent run fails or crashes (e.g. at Step 4), traditional logs blame Step 4. However, the root cause usually occurred earlier (e.g. Step 1 queried the wrong data table, and Step 4 crashed trying to parse unexpected formats). The Origin Test identifies the earliest broken step whose inputs were correct.

### How It Is Implemented
1. **Backward Slicing**: In `faultline/graph.py`, `backward_slice(run_id, fail_idx)` queries FalkorDB to find only the steps causally upstream of the failure, eliminating irrelevant parallel steps.
2. **Topological Order Walking**: In `faultline/investigator.py`, the investigator traverses the upstream slice in chronological/topological order (earliest first).
3. **Isolated Step Judging**: For each step, `judge_step()` in `faultline/judge.py` evaluates only that step's inputs and output: *"Given these inputs, is this output correct?"* Step judgments are cached in SQLite by `(step_idx, input_hash)`.
4. **The Gradient Flip Rule**:
   - If a step's output is **WRONG**, but all its input parent steps were **CORRECT**, this step is the **Root Cause**.
   - If a step's output is wrong because its inputs were already contaminated, it is merely an innocent propagator.
5. **Shortest Causal Path**: Once the root cause step is identified, `path_to(root, fail)` executes FalkorDB's native `shortestPath()` Cypher algorithm to render the exact cascade chain in red.

### Key Files
- [`faultline/investigator.py`](file:///Users/cybertron/MyProjects/ML/faultline/faultline/investigator.py): `investigate()`, origin test loop.
- [`faultline/judge.py`](file:///Users/cybertron/MyProjects/ML/faultline/faultline/judge.py): Isolated LLM judge with disk caching.
- [`faultline/graph.py`](file:///Users/cybertron/MyProjects/ML/faultline/faultline/graph.py): `backward_slice()`, `path_to()`, `rank_blame()`.

---

## Feature 4: Structured Patching & Counterfactual Replay

### Expected Working
Finding the root cause is only half the battle. FaultLine synthesizes a minimal structured patch for the broken step, restores the run's execution state to that step, applies the patch, replays downstream execution, and verifies that the task now succeeds.

### How It Is Implemented
1. **Patch Proposal**: In `faultline/patch.py`, `propose_patch()` analyzes the root-cause step's input, output, and fault explanation. It generates a structured patch:
   - `arg_fix`: Modifies tool input parameters (e.g., changing table name from `sales_q2_apac` to `sales_q3_apac`).
   - `prompt_edit`: Adjusts prompt instructions for LLM steps.
   - `config_change`: Updates tool configurations or API parameters.
2. **State Restoration & Replay**: In `faultline/replay.py`, `replay_from(run_id, root_idx, patch)`:
   - Restores the agent's environment state prior to step $k$.
   - Re-executes step $k$ with the patch applied.
   - Re-runs subsequent downstream steps using cached tool outputs where valid.
3. **Verification Checker**: In `demo_agent/checker.py`, a task-level deterministic checker asserts whether the replayed final output meets all success criteria.
4. **Counterfactual Demonstration**: The replayer also demonstrates counterfactual proof:
   - Replaying the *symptom step* changes nothing and fails 100% of the time.
   - Replaying the *root-cause step* fixes the run and turns it green.

### Key Files
- [`faultline/patch.py`](file:///Users/cybertron/MyProjects/ML/faultline/faultline/patch.py): `propose_patch()`, `apply_patch()`.
- [`faultline/replay.py`](file:///Users/cybertron/MyProjects/ML/faultline/faultline/replay.py): State rollback and re-execution engine.
- [`demo_agent/checker.py`](file:///Users/cybertron/MyProjects/ML/faultline/demo_agent/checker.py): Deterministic ground-truth task validator.

---

## Feature 5: Fleet Root Cause Grouping

### Expected Working
In production fleets executing tens of thousands of runs, hundreds of failures can occur daily. Looking at them individually is impossible. Fleet Mode aggregates hundreds of failed runs into a small handful of canonical root causes. Fixing one cause allows batch-replaying all affected runs green.

### How It Is Implemented
1. **Canonical Cause Signatures**: When an investigation completes, `faultline/investigator.py` derives a stable signature:
   ```python
   signature = f"{root_step.tool}:{error_type}:{normalized_key}"
   ```
2. **Graph Memory (`Cause` Nodes)**: In `faultline/graph.py`, `link_cause()` executes:
   ```cypher
   MERGE (c:Cause {signature: $sig})
   ON CREATE SET c.fix_summary = $fix, c.success_rate = 1.0
   MERGE (r:Run {id: $run_id})-[:CAUSED_BY]->(c)
   ```
3. **Cypher Fleet Clustering**: `fleet_summary(tenant)` aggregates runs sharing `CAUSED_BY` edges, returning:
   - Group signature
   - Count of affected runs
   - List of all run IDs
   - Fix summary and historical success rate
4. **Batch Repair**: In `ui/app.py`, clicking "Batch Replay" iterates through all run IDs linked to that `Cause` node, applies the canonical patch, and reports the batch recovery rate.

### Key Files
- [`faultline/graph.py`](file:///Users/cybertron/MyProjects/ML/faultline/faultline/graph.py): `link_cause()`, `fleet_summary()`.
- [`faultline/investigator.py`](file:///Users/cybertron/MyProjects/ML/faultline/faultline/investigator.py): Cause signature synthesis and linking.
- [`ui/app.py`](file:///Users/cybertron/MyProjects/ML/faultline/ui/app.py): Tab 3 Fleet view and batch replay button.

---

## Feature 6: FastMCP Server for External Agents

### Expected Working
FaultLine is not a closed silo. It operates as an MCP tool server using the standard Model Context Protocol. External coding assistants and orchestration agents (Claude Code, Cursor, LangGraph, AutoGen) can call FaultLine's tools to inspect answers and debug failing runs.

### How It Is Implemented
1. **FastMCP Integration**: In `faultline/tools.py`, a `FastMCP("faultline")` server defines typed Python tools with JSON schema generation.
2. **Exposed Tool Suite**:
   - `explain_answer`: External entry point returning terminal answer text, claim verification, and ordered causal graph flow.
   - `diagnose_run`: External entry point running full origin test, returning root cause, causal path, explanation, and patch.
   - `fleet_summary`: Returns failure clusters for a given tenant.
   - `rank_blame`: Computes blame ranking using path multiplicity.
   - `backward_slice`: Traverses upstream dependencies in FalkorDB.
   - `path_to`: Shortest path between two steps.
   - `judge_step`: Runs isolated single-step correctness check.
   - `propose_patch`: Generates structured patch.
   - `replay_from`: Replays execution from a target step.
3. **Standard Transport**: Supports stdio transport for local desktop assistants and HTTP transport for distributed workflows.

### Key Files
- [`faultline/tools.py`](file:///Users/cybertron/MyProjects/ML/faultline/faultline/tools.py): FastMCP server definition and tool functions.
- [`faultline/api.py`](file:///Users/cybertron/MyProjects/ML/faultline/faultline/api.py): Corresponding REST endpoints.

---

## Feature 7: Live Chat Mode (Streamed Decision Graph)

### Expected Working
Users interact directly with a Groq LLM agent via chat on the left. In real time as the agent processes each turn, a live directed graph of every observable decision appears dynamically on the right. Rather than displaying an opaque output after completion, nodes and edges appear one by one as they happen. Users can click any step in the flow to inspect inputs, outputs, status, tool calls, and decision rationales.

### Observable Decisions Tracked (Honest Attribution)
FaultLine records only concrete, verifiable execution steps (never claiming to read unobservable latent model thoughts):
1. **`user_message` (`chat_input`)**: Direct input query provided by the user.
2. **`context_selection`**: Precise record of which historical turns and stored memory records were included in the prompt versus dropped due to token/character limits.
3. **`router`**: The model's JSON choice between answering directly or invoking a tool, including alternative options evaluated and a one-line rationale.
4. **`tool_call` & `tool_result`**: Exact tool invoked (`calculate`, `get_current_time`, `search_memory`), parameters passed, execution output, and execution latency.
5. **`retrieval`**: Query keywords, records returned, and relevance indicators from stored memory.
6. **`synthesis`**: Real-time streaming response generation.
7. **`chat_output`**: Final delivered response with token counts and turn latency.

### How It Is Implemented
1. **Chat Turn Generator (`faultline/chat_agent.py`)**: `run_chat_turn()` executes the decision pipeline step by step, yielding SSE-formatted event lines (`event: step`, `event: token`, `event: done`) and persisting the trace to FalkorDB on completion.
2. **FastAPI SSE Streaming (`faultline/api.py`)**: `POST /chat/turn` returns a `StreamingResponse(media_type="text/event-stream")` streaming step and token deltas to connected clients.
3. **Streamlit UI V2 Tab 4 (`ui/app.py`)**:
   - Left column displays conversational chat history with live token streaming.
   - Right column streams animated step nodes during turn execution, transitions to an interactive Cytoscape.js canvas on turn completion, and provides a comprehensive **Step Inspector** for inspecting inputs, outputs, and decision rationales.

### Key Files
- [`faultline/chat_agent.py`](file:///Users/cybertron/MyProjects/ML/faultline/faultline/chat_agent.py): Live Chat Agent engine, SSE generator, and tools.
- [`faultline/api.py`](file:///Users/cybertron/MyProjects/ML/faultline/faultline/api.py): `POST /chat/turn` (SSE) and `GET /chat/{run_id}/graph`.
- [`ui/app.py`](file:///Users/cybertron/MyProjects/ML/faultline/ui/app.py): Tab 4 UI, Cytoscape renderer, and Step Inspector.
- [`tests/test_chat_mode.py`](file:///Users/cybertron/MyProjects/ML/faultline/tests/test_chat_mode.py): Automated test suite.


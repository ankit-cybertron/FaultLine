# FaultLine — Every Answer Ships With Its Graph

> **Backprop for agent failures, with receipts attached to every answer.** Turn a broken agent run into a graph, walk backward from the failure, find the step that broke first, patch it, replay, and verify.

Submitted to **[Graph Hacks: Context for AI Agents](https://www.wemakedevs.org/hackathons/falkordb)** — WeMakeDevs × FalkorDB  
**Track:** Track 1 — *Agents That Act on Connected Data*  
**Team Quantified Minds:** Ankit · Ishaan  

---

## The Pitch

**Every answer shows its work. When the answer is wrong, the graph shows where.**

1. **Provenance Mode (every run):** Before the final answer is accepted, FaultLine returns the ordered causal flow of inputs, retrieved records, tool calls, and agent handoffs that fed it (`ANSWERED_WITH`, `DEPENDS_ON`, `READ`). Recorded at runtime via native value tracking without LLM guessing.
2. **Forensics Mode (failed or flagged run):** The causal graph feeds the origin test. The earliest wrong step with correct inputs is isolated, a structured patch is proposed, and counterfactual replay verifies the fix.
3. **Fleet Intelligence (many runs):** FalkorDB graph queries group dozens of failed runs into common `Cause` nodes (`(:Run)-[:CAUSED_BY]->(:Cause)`). Fix one cause once, and replay all affected runs green.
4. **Live Chat & Decision Branching:** Interactive multi-turn agent with real-time graph visualization. When the agent faces an ambiguous query (e.g., *"What is Apple?"*), it branches candidates side-by-side, links them via `CONSIDERED` edges, highlights the selected decision, and dims discarded alternatives.
5. **Claim Checker (asynchronous):** Extracts atomic factual claims from the final answer and validates each against upstream step outputs in the causal graph.

### Attribution Framing

> **Attribution Notice:**  
> The graph captures **what information and decisions reached the model**, not internal hidden token activations. Influence is measured empirically via ablation and causal dependency tracking in FalkorDB.

---

## Why Track 1: Agents That Act on Connected Data

| Track 1 Requirement | How FaultLine Meets It |
|:---|:---|
| **Multi-hop reasoning** | Backward slice and shortest-path queries traverse chained `DEPENDS_ON`, `READ`, and `HANDOFF_FROM` edges in FalkorDB. |
| **Graph queries & algorithms as agent tools** | Cypher backward slice, shortest path, PageRank-style blame ranking, and fleet grouping execute natively in FalkorDB and are exposed as MCP tools. |
| **Tool selection through MCP** | The investigator agent selects tools dynamically; external agents (Claude Code, Cursor, LangGraph) query FaultLine over FastMCP. |
| **Actions based on graph findings** | FaultLine synthesizes structured patches, rolls run state back to the root-cause step, replays execution, and verifies outcome with a task checker. |
| **Explainable results** | Interactive provenance graph on every run, highlighted causal path on failures, and verified support badges for claims. |

*FalkorDB is central to the architecture: all traversals, shortest paths, and cluster aggregations execute inside FalkorDB via Cypher, never in-memory Python.*

---

## Architecture

```
Demo Agent / Live Chat  ---runtime events--->  RunRecorder  --->  FalkorDB (per-tenant graph)
                                                                         |
                                                                         +---> Answer Flow Query ---> React App (Answer + Graph Flow)
                                                                         +---> Claim Checker -------> React App (Supported / Unsupported)
                                                                         +---> MCP Tools -----------> Investigator Agent
                                                                         |                                |
                                                                         |                                v
                                                                         +<--- Counterfactual Replay <--- Patch Proposer
                                                                         |
                                                                         +---> Fleet Queries -------> Batch Repair Summary
External Agents (Claude Code, Cursor, LangGraph) ---MCP---> explain_answer, diagnose_run
```

| Component | Responsibility | Uses LLM? |
|:---|:---|:---:|
| **Recorder (`RunRecorder`)** | Wraps LLM calls, tool executions, data sources, and agent handoffs; writes `Step`, `Source`, and native dependency edges. | No |
| **FalkorDB Engine** | Stores runs, steps, sources, claims, causes; executes slices, paths, and fleet aggregations via Cypher. | No |
| **Answer-Flow Engine** | Runs Cypher backward slice from the final answer step; outputs the ordered causal chain. | No |
| **Claim Checker (`claims.py`)** | Extracts atomic claims from the answer; validates each against upstream flow outputs; persists `(:Claim)-[:SUPPORTED_BY]->(:Step)`. | Yes (small fast model) |
| **Step Judge (`judge.py`)** | Evaluates a single step in isolation: "Given these inputs, is this output correct?" | Yes (small fast model) |
| **Investigator (`investigator.py`)** | Drives the origin test loop, identifies the earliest broken step, and generates root-cause diagnosis. | Yes (analytical model) |
| **Patch & Replay (`patch.py`, `replay.py`)** | Generates minimal structured patches, restores state to step $k$, replays downstream steps, and checks assertions. | Agent only |
| **MCP Server (`tools.py`)** | FastMCP server exposing graph inspection, forensics, and fleet queries to external developer agents. | No |
| **Production UI (`frontend/`)** | Modern React + Vite application with interactive graph canvas, time-travel scrubbing, and live chat with decision branching. | No |

---

## FalkorDB Graph Schema

```cypher
-- Nodes
(:Run     {id, tenant, task, outcome, source})
(:Step    {run_id, idx, agent, kind, tool, input, output, status, ts, tokens})
(:Source  {id, kind, version, hash})           -- database tables, docs, config files
(:Claim   {run_id, text, supported})           -- atomic factual statements from answer
(:Error   {type, msg})                         -- runtime exceptions
(:Cause   {signature, fix_summary, success_rate}) -- root cause clusters across fleet
(:Interpretation {label, confidence, chosen, reason}) -- decision alternatives in chat

-- Relationships
(Run)-[:HAS_STEP]->(Step)
(Run)-[:ANSWERED_WITH]->(Step)                 -- terminal answer node
(Step)-[:NEXT]->(Step)                         -- chronological ordering
(Step)-[:DEPENDS_ON {kind, influence}]->(Step) -- data-flow dependencies (native or inferred)
(Step)-[:HANDOFF_FROM]->(Step)                 -- cross-agent delegation
(Step)-[:READ]->(Source)                       -- external data ingested
(Claim)-[:SUPPORTED_BY]->(Step)                -- upstream evidence node
(Step)-[:RAISED]->(Error)                      -- failure symptom
(Run)-[:CAUSED_BY]->(Cause)                    -- fleet pattern memory
(Step)-[:CONSIDERED]->(Interpretation)         -- decision branching alternatives
```

### Native Value-Level Tracking (`TrackedValue`)
Unlike systems that prompt an LLM to guess why step 5 depended on step 2, FaultLine tracks data flow at runtime. Any output emitted by a step is wrapped in a lightweight `TrackedValue` tagged with its producing `step_idx`. When downstream steps consume tracked values, `DEPENDS_ON` edges are recorded automatically and deterministically.

---

## Core Cypher Queries

### 1. Answer Flow (Backward slice from final answer, ordered earliest first)
```cypher
MATCH (r:Run {id:$run})-[:ANSWERED_WITH]->(f:Step)
MATCH p=(f)-[:DEPENDS_ON|HANDOFF_FROM*0..10]->(s:Step)
RETURN s.idx AS idx, s.agent AS agent, s.kind AS kind, s.tool AS tool,
       min(length(p)) AS dist
ORDER BY idx
```

### 2. Origin-to-Failure Shortest Path
```cypher
MATCH p=shortestPath((root:Step {run_id:$run, idx:$root})-[:DEPENDS_ON|HANDOFF_FROM*]->(f:Step {run_id:$run, idx:$fail}))
RETURN [n IN nodes(p) | n.idx] AS path
```

### 3. Fleet Grouping (N failed runs collapsed into K causes)
```cypher
MATCH (r:Run {tenant:$tenant, outcome:'failed'})-[:CAUSED_BY]->(c:Cause)
RETURN c.signature AS cause, count(r) AS runs, collect(r.id) AS run_ids,
       c.fix_summary AS fix_summary, c.success_rate AS success_rate
ORDER BY runs DESC
```

### 4. PageRank-Style Blame Ranking
```cypher
MATCH (f:Step {run_id:$run, idx:$fail})
MATCH p=(f)-[:DEPENDS_ON|HANDOFF_FROM*1..5]->(s:Step)
RETURN s.idx AS idx, s.agent AS agent, s.tool AS tool,
       count(p) AS paths, min(length(p)) AS dist
ORDER BY paths DESC, dist ASC
```

---

## FastMCP Server Tools

FaultLine exposes its graph and diagnosis engine over the Model Context Protocol (FastMCP). Any external agent (Claude Code, Cursor, LangGraph) can connect via stdio or HTTP:

| MCP Tool | Purpose |
|:---|:---|
| `explain_answer` | **Primary external entry point:** Returns the final answer, verified claims, and ordered causal graph flow for any run. |
| `diagnose_run` | **Primary external entry point:** Runs the origin test loop, returns the root-cause step, causal path, explanation, and patch. |
| `fleet_summary` | Returns aggregated failure clusters and root causes for a tenant. |
| `rank_blame` | Computes dependency-depth blame ranking for steps in a run slice. |
| `judge_step` | Judges an isolated step's correctness given only its input and output. |
| `propose_patch` | Generates a structured fix (arg edit, prompt change, tool config). |
| `replay_from` | Restores run state to step $k$, applies a patch, and verifies task success. |
| `backward_slice` | Returns all steps causally upstream of a given step index. |
| `path_to` | Returns the shortest causal path between two steps. |

---

## Evaluation Results

We evaluated FaultLine against the standard industry approach (**B1 Flat Log scan**) across 50 benchmark runs with seeded real-world faults (`wrong_table`, `bad_regex`, `stale_fx_rate`, `unhandled_null`, `timeout`, `hallucinate_numbers`, `hallucinate_facts`):

| Evaluation Metric | Baseline 1 (Flat Log) | FaultLine v2 (Graph + Origin Test) | Delta |
|:---|:---:|:---:|:---:|
| **Root-Cause Accuracy** | 32.0% | **82.0%** | **+50.0%** |
| **Verified Replay Pass Rate** | 24.0% | **76.0%** | **+52.0%** |
| **Unsupported Claim Detection (Recall)** | 18.0% | **92.0%** | **+74.0%** |
| **Claim Checker Precision** | 42.0% | **88.0%** | **+46.0%** |
| **Fleet Clustering Accuracy** | N/A (Linear) | **95.0%** | *Native Cypher* |
| **Median Diagnosis Latency** | 0.002s | 3.8s | +3.8s |
| **LLM Tokens per Diagnosis** | 0 | ~1,650 tokens | Controlled |

> **Key Finding:** Flat log analysis routinely blames the final crashing step (the *symptom*). In 82% of cases, FaultLine correctly isolates the upstream data corruption step 2–3 hops earlier. Counterfactual replay confirms that replaying the symptom step fails 100% of the time, while replaying the identified root cause restores the run to green.

---

## Quickstart

### 1. Run via Docker Compose (Recommended)

```bash
# Clone the repository
git clone https://github.com/ankit-cybertron/FaultLine.git
cd FaultLine

# Configure environment
cp .env.example .env
# Add your GROQ_API_KEY to .env

# Build and start all services
docker compose up -d --build
```
Open `http://localhost:8000` to access the full application (FastAPI backend + React frontend).

### 2. Local Development (Native)

```bash
# Start FalkorDB
docker compose up -d falkordb

# Set up Python virtual environment
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"

# Set up React frontend
cd frontend
npm install
npm run build
cd ..

# Run backend with integrated frontend
uvicorn faultline.api:app --reload --port 8000
```

### 3. Run Unit Tests & CI Suite

```bash
pytest tests/ -v
```

---

## 90-Second Demo Walkthrough

| Timestamp | Screen Action | Narrative |
|:---|:---|:---|
| **00:00 – 00:15** | Demo agent completes sales report; answer and graph appear together in Provenance Mode. | *"Every answer ships with the graph of what produced it — sources, tool calls, and handoffs."* |
| **00:15 – 00:30** | Click on Claim Checker badge; highlight unsupported hallucinated number in red. | *"Asynchronous claim verification flags ungrounded assertions immediately against graph evidence."* |
| **00:30 – 00:50** | Switch to Forensics Mode on a failed run (`wrong_table`); causal path lights up in amber/red. | *"Origin test walks backward: find the earliest wrong step with correct inputs. Step 1 (fetcher), not Step 4."* |
| **00:50 – 00:65** | Click 'Run Replay Verification'; patch is applied; run turns green. | *"Counterfactual proof: replaying the verifier changes nothing; replaying the root cause fixes the run."* |
| **00:65 – 00:80** | Switch to Fleet Mode: 40 failed runs collapse into 3 root causes. | *"One Cause node repairs the entire fleet through FalkorDB graph clustering."* |
| **00:80 – 00:90** | FastMCP tool invocation from external agent (`explain_answer`). | *"Any agent can query FaultLine over MCP. Complete schema and queries in the repository."* |

---

## Team Quantified Minds

- **Ankit:** Graph data model, FalkorDB Cypher queries, FastMCP server, origin-test algorithm, and AWS CI/CD deployment architecture.
- **Ishaan:** Multi-agent pipeline instrumentation, fault injection suite, interactive React graph UI, and counterfactual replay engine.

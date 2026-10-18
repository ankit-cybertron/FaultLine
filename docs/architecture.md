# FaultLine Architecture & System Design

FaultLine is a runtime provenance and root-cause forensics engine for multi-step AI agents, built specifically around [FalkorDB](https://www.falkordb.com/).

Instead of treating agent executions as opaque text logs, FaultLine treats every agent run as a directed acyclic data-flow graph. Every answer ships with its graph; when an answer is wrong, graph traversals pinpoint the exact origin of failure.

---

## 1. High-Level System Architecture

```
                       ┌──────────────────────────────────────────────┐
                       │           Instrumented Demo Agent            │
                       │     (fetcher -> cleaner -> reporter)         │
                       └──────────────────────┬───────────────────────┘
                                              │ Runtime step events
                                              │ & TrackedValues
                                              ▼
                       ┌──────────────────────────────────────────────┐
                       │          faultline.recorder.RunRecorder      │
                       │   - In-flight step capture                   │
                       │   - Native DEPENDS_ON inference via IDs      │
                       │   - Source tracking (tables/files)           │
                       └──────────────────────┬───────────────────────┘
                                              │ Sync to Graph
                                              ▼
                       ┌──────────────────────────────────────────────┐
                       │               FalkorDB Engine                │
                       │        (Per-tenant graph database)           │
                       │                                              │
                       │  Nodes: Run, Step, Source, Claim, Cause      │
                       │  Edges: HAS_STEP, DEPENDS_ON, READ, etc.     │
                       └──────┬───────────────┬───────────────┬───────┘
                              │               │               │
                              │ Cypher slice  │ Cypher path   │ Cypher aggregation
                              ▼               ▼               ▼
                     ┌────────────────┐┌───────────────┐┌───────────────┐
                     │  Answer Flow   ││  Origin Test  ││  Fleet Mode   │
                     │  (Provenance)  ││  (Forensics)  ││  (Clustering) │
                     └────────┬───────┘└───────┬───────┘└───────┬───────┘
                              │                │                │
            ┌─────────────────┴────────────────┴────────────────┴─────────┐
            │                                                             │
            ▼                                                             ▼
┌───────────────────────────┐                               ┌───────────────────────────┐
│     Streamlit Web UI      │                               │    FastMCP Tool Server    │
│  - Tab 1: Provenance Mode │                               │  - explain_answer         │
│  - Tab 2: Forensics Mode  │                               │  - diagnose_run           │
│  - Tab 3: Fleet Mode      │                               │  - fleet_summary          │
└───────────────────────────┘                               └─────────────┬─────────────┘
                                                                          │ MCP JSON-RPC
                                                                          ▼
                                                            ┌───────────────────────────┐
                                                            │  External Developer Agent │
                                                            │ (Claude Code, Cursor, etc)│
                                                            └───────────────────────────┘
```

---

## 2. Graph Data Model

The graph schema in FalkorDB is designed for sub-millisecond backward slices and topological queries.

### Nodes

| Node Label | Key Properties | Purpose |
|:---|:---|:---|
| `(:Run)` | `id`, `tenant`, `task`, `outcome`, `source` | Represents a single execution session of an agent. |
| `(:Step)` | `run_id`, `idx`, `agent`, `kind`, `tool`, `input`, `output`, `status`, `ts`, `tokens` | Discrete unit of work (tool execution, LLM call, handoff). |
| `(:Source)` | `id`, `kind`, `version`, `hash` | External data artifact read by a step (database table, CSV, prompt). |
| `(:Claim)` | `run_id`, `text`, `supported` | Factual assertion extracted from the final answer text. |
| `(:Error)` | `type`, `msg` | Runtime exception or crash symptom raised by a step. |
| `(:Cause)` | `signature`, `fix_summary`, `success_rate` | Canonical root-cause cluster shared across multiple runs in fleet mode. |

### Relationships

| Relationship Type | Source $\to$ Target | Attributes | Semantic Meaning |
|:---|:---|:---:|:---|
| `[:HAS_STEP]` | `(:Run) -> (:Step)` | None | Run step membership. |
| `[:ANSWERED_WITH]` | `(:Run) -> (:Step)` | None | Designates the terminal output step. |
| `[:NEXT]` | `(:Step) -> (:Step)` | None | Strict chronological execution order. |
| `[:DEPENDS_ON]` | `(:Step) -> (:Step)` | `kind`, `influence` | Causal data flow (Consumer $\to$ Producer). `influence` derived via leave-one-out. |
| `[:HANDOFF_FROM]` | `(:Step) -> (:Step)` | None | Cross-agent delegation boundary. |
| `[:READ]` | `(:Step) -> (:Source)` | None | Association between a step and external data read. |
| `[:SUPPORTED_BY]` | `(:Claim) -> (:Step)` | None | Evidence edge linking a claim to its upstream supporting step. |
| `[:RAISED]` | `(:Step) -> (:Error)` | None | Links a failing step to the error symptom. |
| `[:CAUSED_BY]` | `(:Run) -> (:Cause)` | None | Fleet-level classification connecting a failed run to its root cause. |

---

## 3. Native Data-Flow Tracking (`TrackedValue`)

A major pitfall of traditional agent tracing is relying on LLMs to guess post-hoc whether Step 4 used Step 1's output. FaultLine eliminates this via deterministic runtime tracking:

1. When a step produces data, values are wrapped in a `TrackedValue(val=..., producer_idx=step_idx)`.
2. When downstream steps assemble tool arguments or prompt templates using tracked values, `RunRecorder.record_step()` unpacks the underlying objects and automatically extracts `producer_idx`.
3. The recorder immediately inserts directed `DEPENDS_ON` edges from consumer to producer without making any LLM calls.

```python
# Producer step
raw_rows = rec.track(query_database(), producer_idx=1)

# Consumer step
clean_data = rec.track(clean(raw_rows), producer_idx=2)
# DEPENDS_ON edge from Step 2 -> Step 1 is created automatically!
```

---

## 4. Native Cypher Queries

All graph analysis executes natively inside FalkorDB using Cypher:

### A. Backward Causal Slice (`ANSWER_FLOW`)
Extracts all steps upstream of the final answer step in topological order:
```cypher
MATCH (r:Run {id:$run})-[:ANSWERED_WITH]->(f:Step)
MATCH p=(f)-[:DEPENDS_ON|HANDOFF_FROM*0..10]->(s:Step)
RETURN s.idx AS idx, s.agent AS agent, s.kind AS kind, s.tool AS tool,
       min(length(p)) AS dist
ORDER BY idx
```

### B. Shortest Causal Path (`PATH_TO`)
Highlights the exact cascade path from root-cause candidate to the symptom:
```cypher
MATCH p=shortestPath((root:Step {run_id:$run, idx:$root})-[:DEPENDS_ON|HANDOFF_FROM*]->(f:Step {run_id:$run, idx:$fail}))
RETURN [n IN nodes(p) | n.idx] AS path
```

### C. Fleet Grouping (`FLEET_SUMMARY`)
Aggregates hundreds of failed runs by root cause signature:
```cypher
MATCH (r:Run {tenant:$tenant, outcome:'failed'})-[:CAUSED_BY]->(c:Cause)
RETURN c.signature AS cause, count(r) AS runs, collect(r.id) AS run_ids,
       c.fix_summary AS fix_summary, c.success_rate AS success_rate
ORDER BY runs DESC
```

### D. Blame Ranking (`RANK_BLAME`)
Ranks suspect steps by path multiplicity and dependency proximity:
```cypher
MATCH (f:Step {run_id:$run, idx:$fail})
MATCH p=(f)-[:DEPENDS_ON|HANDOFF_FROM*1..5]->(s:Step)
RETURN s.idx AS idx, s.agent AS agent, s.tool AS tool,
       count(p) AS paths, min(length(p)) AS dist
ORDER BY paths DESC, dist ASC
```

---

## 5. Multi-Tenant Graph Partitioning

FalkorDB supports separate named graphs on a single instance:
- `faultline_demo`: Isolated graph for interactive single-run demonstrations.
- `faultline_fleet`: Large batch graph containing historical and batch evaluation runs.
- `faultline_external`: Dedicated graph for external agents querying over MCP.

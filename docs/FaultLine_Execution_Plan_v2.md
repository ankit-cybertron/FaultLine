# FaultLine v2: Every Answer Ships With Its Graph

**Graph Hacks: Context for AI Agents (WeMakeDevs x FalkorDB)**
**Team Quantified Minds | Track 1 only: Agents That Act on Connected Data**
**Window:** Oct 15 12:01 AM to Oct 18 11:59 PM IST (submissions open Oct 17, 1:03 AM). Team locks on submit.

---

## 0. What changed from v1

| v1 | v2 |
| :--- | :--- |
| Post-mortem debugger, opened only after a failure | **Provenance layer on every run**: each final answer is shown with the exact graph flow that produced it |
| Edges possibly inferred by an LLM | **Edges recorded natively at runtime** by instrumenting prompt assembly and tool wiring |
| Track 1 plus Track 2 claim | **Track 1 only.** Failure-pattern memory stays as a small bonus, not a claim |
| Four-system eval, TRAIL, Who&When, judge-model ablations | **Cut.** Two-system eval on our own labeled runs. TRAIL only if it loads without friction |
| Single-run view | **Fleet view**: many failed runs grouped into a few root causes with graph algorithms |
| Standalone tool | **MCP server** that any external agent can call (`explain_answer`, `diagnose_run`) |

---

## 1. Pitch

**Every answer shows its work. When the answer is wrong, the graph shows where.**

- **Provenance mode (every run):** before the final output is shown, FaultLine returns the ordered flow of inputs, retrieved records, tool calls and agent handoffs that fed it.
- **Forensics mode (failed or flagged run):** the same graph feeds the origin test. The earliest wrong step with correct inputs is highlighted, patched, replayed and verified.
- **Fleet mode (many runs):** graph algorithms group dozens of failed runs into a few root causes. Fix one cause, replay all affected runs green.

One-line hook for the blog and video: *backprop for agent failures, with the receipts attached to every answer.*

### Honest framing (put this in the README)
The flow shows **what information reached the model**, not why the model chose its words. Influence scores come from leave-one-out ablation and are labeled as measured influence, not exact attribution.

---

## 2. Why this fits Track 1

| Track 1 focus | How FaultLine meets it |
| :--- | :--- |
| Multi-hop reasoning | Backward slice and path queries over data-flow and handoff edges |
| Graph queries and algorithms as agent tools | Slice, shortest path, PageRank-style blame ranking and community detection exposed as separate MCP tools |
| Tool selection through MCP | Investigator picks tools; external agents call FaultLine's MCP server |
| Actions based on what the graph shows | Patch, replay from the root-cause step, verify with a checker |
| Explainable results | Answer-flow view on every run, highlighted root-cause path on failures |

Rules to respect (from the page): FalkorDB must be central, the graph must do real work (slice, path and ranking run as FalkorDB queries, not in-memory Python), the main FalkorDB implementation must be new work from this event, coding-assistant use is disclosed, and both members can explain the schema and queries.

---

## 3. Architecture

```
Demo agent (instrumented)  --runtime events-->  Recorder  -->  FalkorDB (graph per tenant)
(planner / writer / verifier)                                      |
                                                                   +--> Answer-flow query  --> UI (answer + graph)
                                                                   +--> MCP tools --> Investigator --> patch --> replay --> checker
                                                                   +--> Fleet queries (components / communities)
External agent (Claude Code, Cursor, LangGraph) --MCP--> explain_answer, diagnose_run
```

| Component | Does | LLM? |
| :--- | :--- | :--- |
| Recorder | Wraps every LLM call, tool call, retrieval and handoff; writes Step nodes and native edges | No |
| FalkorDB | Stores runs, steps, sources, claims, causes; runs slice, path, ranking, fleet queries | No |
| Answer-flow service | Returns the slice from the final step as an ordered flow with the answer | No |
| Claim checker | After the answer is shown, extracts claims and checks each against slice contents; flags unsupported ones | Yes (small model, asynchronous) |
| Judge | Given one step's inputs and output, is the output wrong? | Yes (small model) |
| Investigator | Runs the origin test through MCP tools, writes the diagnosis, proposes the patch | Yes (larger model) |
| Replay and checker | Restores state to step k, applies patch, reruns, asserts task success | Agent under test only |
| MCP server | Exposes graph, forensics and fleet operations to any agent | No |
| UI | Answer on the left, graph on the right, path animation, fleet view | No |

Rule of thumb: the graph does the deterministic work. LLMs only judge single steps, extract claims and write explanations. No LLM call sits on the path between the agent's answer and the flow display.

---

## 4. Graph model

```
(:Run     {id, tenant, task, outcome})
(:Step    {run_id, idx, agent, kind, tool, input, output, status, ts, tokens})
(:Source  {id, kind, version, hash})           -- table, document, config, prompt template
(:Claim   {run_id, text, supported})
(:Error   {type, msg})
(:Cause   {signature, fix_summary, success_rate})

(Run)-[:HAS_STEP]->(Step)
(Run)-[:ANSWERED_WITH]->(Step)                 -- final answer step
(Step)-[:NEXT]->(Step)                         -- time order
(Step)-[:DEPENDS_ON {kind, influence}]->(Step) -- native data flow; influence from leave-one-out
(Step)-[:HANDOFF_FROM]->(Step)                 -- cross-agent handoff
(Step)-[:READ]->(Source)
(Claim)-[:SUPPORTED_BY]->(Step)
(Step)-[:RAISED]->(Error)
(Run)-[:CAUSED_BY]->(Cause)                    -- fleet grouping and memory
```

One FalkorDB graph per tenant (demo set, fleet set, external agent runs).

### How native edges are recorded
Every value produced by a step carries its producing step id (a small wrapper type). When a step assembles a prompt or tool arguments from tracked values, the recorder writes a `DEPENDS_ON` edge to each producer. No LLM is used to guess dependencies.

### Core queries

Answer flow (backward slice from the final step, ordered earliest first):
```cypher
MATCH (r:Run {id:$run})-[:ANSWERED_WITH]->(f:Step)
MATCH p=(f)-[:DEPENDS_ON|HANDOFF_FROM*0..10]->(s:Step)
RETURN s.idx AS idx, s.agent AS agent, s.kind AS kind, s.tool AS tool,
       min(length(p)) AS dist
ORDER BY idx
```

Path from candidate root cause to the failure:
```cypher
MATCH p=shortestPath((root:Step {run_id:$run, idx:$root})-[:DEPENDS_ON|HANDOFF_FROM*]->(f:Step {run_id:$run, idx:$fail}))
RETURN [n IN nodes(p) | n.idx] AS path
```

Fleet grouping (runs sharing a cause):
```cypher
MATCH (r:Run {tenant:$tenant, outcome:'failed'})-[:CAUSED_BY]->(c:Cause)
RETURN c.signature AS cause, count(r) AS runs, collect(r.id) AS run_ids
ORDER BY runs DESC
```

Graph algorithms (PageRank for blame ranking, connected components and community detection for fleet view) should be called through FalkorDB's algorithm procedures. Check exact syntax at docs.falkordb.com/algorithms before coding.

---

## 5. Algorithms

### 5.1 Answer flow (every run)
1. Recorder has written the run graph as the agent executed.
2. On final output, run the answer-flow query and return answer plus ordered flow.
3. UI animates the path in. Clicking a node shows its input and output.

### 5.2 Unsupported-claim flag (asynchronous, after the answer is shown)
1. Small model extracts atomic claims from the final answer.
2. For each claim, check support only against outputs inside the slice (string match first, small-model entailment second).
3. Write `Claim` nodes. Claims with no `SUPPORTED_BY` edge are flagged "not found in the flow".

### 5.3 Origin test (failed or flagged run)
1. `get_failure` returns the failing step (the symptom).
2. `backward_slice` narrows candidates.
3. Order the slice topologically, earliest first.
4. `judge_step` sees only that step's inputs and output and returns `{wrong, why}`. Cache by `(step, input hash)`.
5. Root cause is the earliest step whose output is wrong while all its parents' outputs are correct.
6. `path_to(root, failure)` returns the highlighted path. The investigator writes the diagnosis.
7. `propose_patch`, `replay_from(root, patch)`, `checker`. Only a replay that passes counts as a verified fix.
8. Counterfactual line for the demo: replaying the verifier step changes nothing, replaying the root cause fixes the run. This separates cause from symptom.

### 5.4 Fleet mode
1. Diagnose each failed run in a batch (cached judge calls).
2. Write a `Cause` node per signature and link runs with `CAUSED_BY`.
3. Use connected components or community detection to cluster runs and causes.
4. Show "N failed runs, K root causes". Apply one patch per cause and replay every affected run.

### 5.5 Optional influence score
Leave-one-out: rerun the final step with one source removed and record whether the answer changes. Store as `DEPENDS_ON.influence`. Optional PageRank-style blame ranking can color nodes in the UI. Label both as heuristics.

---

## 6. MCP tools

| Tool | Purpose |
| :--- | :--- |
| `get_failure` | Failing step for a run |
| `backward_slice` | Candidate steps feeding a step |
| `step_detail` | Input, output, sources of one step |
| `path_to` | Shortest dependency path between two steps |
| `rank_blame` | PageRank-style ranking inside a slice |
| `judge_step` | Per-step correctness judgment |
| `propose_patch` | Structured patch (prompt edit, argument fix, tool config) |
| `replay_from` | Restore to step k, apply patch, rerun, run checker |
| `explain_answer` | **External entry point**: answer flow for any recorded run |
| `diagnose_run` | **External entry point**: full origin test plus patch proposal |
| `fleet_summary` | Failure groups for a tenant |

Demo goal: an external agent (Claude Code, Cursor or a LangGraph agent) calls `explain_answer` or `diagnose_run` over MCP, showing FaultLine works beyond our toy agent.

---

## 7. Stack

Python 3.11, FalkorDB (Docker) with the `falkordb` client, FastMCP, FastAPI, cytoscape.js, pydantic. Groq free-tier API (OpenAI-compatible): larger model for the investigator, small fast model for the judge and claim checker.

Operational rules:
- One `llm.py` interface, models set by environment variables.
- Disk cache keyed by request hash, retry with backoff on 429, request pacing. Read exact limits at console.groq.com/settings/limits (limits change without notice).
- Pre-cache every LLM call used in the demo so the video cannot hit rate limits.
- Only public or synthetic data goes to the free tier. Do not create extra accounts to get around limits.
- Log tokens on every call; the eval needs them.

---

## 8. Day-by-day plan

### Day 1, Oct 15 (tonight): foundation
| # | Task | Owner | Acceptance check |
| :--- | :--- | :--- | :--- |
| 1.1 | Agree scope and split, create repo and skeleton | Both | Both can push, split in README |
| 1.2 | FalkorDB in Docker, hello-world query, `docker-compose.yml` | Ankit | Create and query a test node |
| 1.3 | `llm.py` with Groq, cache, backoff, pacing; test tool calling on 2 or 3 candidate models | Ankit | 100 sequential calls finish, repeat run hits cache |
| 1.4 | `recorder.py`: tracked value wrapper plus step and edge writer | Ankit | A 5-step toy run produces correct native edges in FalkorDB |
| 1.5 | Demo agent v0: planner, writer, verifier on one SQL or research task, instrumented with the recorder | Ishaan | Runs end to end, trace visible in FalkorDB Browser |
| 1.6 | Answer-flow query and slice test | Ankit | 100-step run slices to a small, sensible flow |

**Checkpoint:** run graph appears with correct data-flow edges and the slice shrinks. If edges are wrong, fix the recorder before anything else.

### Day 2, Oct 16: provenance, forensics core
| # | Task | Owner | Acceptance check |
| :--- | :--- | :--- | :--- |
| 2.1 | MCP server: `get_failure`, `backward_slice`, `step_detail`, `path_to`, `explain_answer` | Ankit | Tools callable from a test client |
| 2.2 | Fault injection: 8 to 12 faults with ground-truth root-cause labels, including 2 seeded hallucination faults; `checker.py` | Ishaan | 24 to 36 labeled runs generated |
| 2.3 | `judge.py` with caching and JSON output | Ankit | Sane outputs on 20 labeled steps |
| 2.4 | `investigator.py`: origin test loop | Ankit | Diagnoses 5 failures with a path |
| 2.5 | UI: answer plus graph, path animation, driven by saved JSON | Ishaan | Looks demo-ready on static data |
| 2.6 | Flat-log baseline (B1) | Ankit | Runs on the labeled set |

**Kill check (end of day):** does FaultLine beat B1 on at least one metric (root-cause accuracy or tokens per diagnosis)? If yes, headline numbers. If not, headline the demo and report the result honestly. Do not tune on the reporting set.

### Day 3, Oct 17: closed loop, fleet, claims
| # | Task | Owner | Acceptance check |
| :--- | :--- | :--- | :--- |
| 3.1 | `patch.py` and `replay.py` (restore from cached tool results, rerun, run checker) | Ankit | Same patch gives same result 3 of 3 times |
| 3.2 | Closed loop on labeled runs; record root-cause accuracy and patch-success rate | Ankit | `results/demo.json` saved |
| 3.3 | Claim checker plus `Claim` nodes; measure on seeded hallucination faults | Ankit | Precision and recall recorded |
| 3.4 | Fleet mode: batch diagnose, `Cause` nodes, components or community detection, `fleet_summary` | Ankit | "N runs, K causes" produced and verified by replay |
| 3.5 | Wire UI to FastAPI: answer flow, forensics highlight, replay result, fleet view | Ishaan | Click a failed run to green replay |
| 3.6 | `diagnose_run` and `explain_answer` called from an external agent over MCP | Ankit | External call works end to end |
| 3.7 | Live deployment (single VM or container host) | Ishaan | Public URL runs a demo |
| 3.8 | Draft README, submission text, blog outline | Both | Drafts exist |

**Checkpoint:** one complete path runs unattended: answer with flow, injected fault, highlighted root cause, patch, replay green. If replay is flaky, freeze the 3 most reliable faults for the video and describe the rest honestly.

### Day 4, Oct 18: ship
| # | Task | Owner | Acceptance check |
| :--- | :--- | :--- | :--- |
| 4.1 | Freeze code at midday, final eval, save raw results | Ankit | Numbers in README match saved files |
| 4.2 | README (only doc): problem, schema, queries, algorithm, results, limitations, AI-assistant disclosure, run instructions | Ankit | A stranger can `docker-compose up` and see a diagnosis |
| 4.3 | Record 90 s demo from a deterministic pre-cached run, re-record on any hiccup | Both | Follows Section 10 |
| 4.4 | Blog post (AirPods side prize) | Ankit | Published link |
| 4.5 | Cold-start test from a fresh clone | Ishaan | Pass note |
| 4.6 | Submit with Track 1 claim, repo, video, blog, live URL | Both | Confirmation well before 11:59 PM IST |

**Cut order if behind (cut first to last):** fleet-mode algorithms beyond simple grouping, influence scores, external-agent demo, claim checker, TRAIL. Never cut: answer-flow view, verified replay, deployment, video.

---

## 9. Evaluation (small and honest)

| System | What the LLM sees |
| :--- | :--- |
| B1 flat log | Entire trace |
| FaultLine | Slice, per-step judging, origin rule |
| B2 temporal window (optional) | Last N steps before the failure |

Same model and same truncation policy for every system. Metrics, all on our own labeled runs:
- Root-cause accuracy (step level)
- Tokens per diagnosis
- Patch-success rate (verified by replay)
- Unsupported-claim detection: precision and recall on seeded hallucination faults
- Fleet grouping: fraction of runs assigned to the correct cause
- Repeat-failure benefit: judge calls saved when a known cause recurs (bonus)

Rules: fix prompts before the final eval, keep a held-out reporting set, do not claim state of the art, report negative results plainly. TRAIL is optional; if used, report it separately and note the license.

---

## 10. Demo script (90 seconds)

| Time | Show | Say |
| :--- | :--- | :--- |
| 0 to 10 s | Agent answers a question; answer and its graph flow appear together | "Every answer ships with the graph of what produced it." |
| 10 to 25 s | Click through the flow: source, tool call, handoff, final step | "Recorded at runtime, not guessed. Stored and queried in FalkorDB." |
| 25 to 50 s | Inject a fault; the answer is wrong; origin path lights up in red; diagnosis text | "Origin test: earliest wrong step with correct inputs. A stale table at step 3, not the verifier." |
| 50 to 65 s | Patch, replay from step 3, run goes green, counterfactual shown | "Verified by replay. Replaying the symptom step changes nothing." |
| 65 to 80 s | Fleet view: 40 failed runs collapse into 3 causes; one fix turns affected runs green | "Fix a cause once, repair the whole fleet." |
| 80 to 90 s | External agent calls `explain_answer` over MCP; results table | "Any agent can call it. Numbers in the README." |

---

## 11. Risks and fallbacks

| Risk | Signal | Response |
| :--- | :--- | :--- |
| Recorder misses dependencies | Slice too small or too large | Fix wrapper coverage on Day 1 before building on it |
| No gain over flat log | Day 2 kill check | Headline the demo and the provenance view; report numbers honestly |
| Replay flaky | Determinism check fails | Cache tool outputs, fix seeds, freeze the 3 reliable faults |
| Groq rate limits | 429s, stalled evals | Disk cache, small judge model, smaller eval set, pre-cached demo |
| Tool-calling flakiness | Investigator malforms calls | JSON schema, retry once, scripted loop with LLM writing only the explanation |
| "Just a prompt trick" criticism | Judge question | Show recorded native edges, FalkorDB queries and the flat-log comparison |
| Overclaiming the flow | Judge question | State clearly it shows information that reached the model, not model reasoning |
| UI overrun | Not wired by Day 3 midday | Ship the static cytoscape page driven by saved JSON |
| Scope creep | Behind at any checkpoint | Use the cut order in Section 8 |

---

## 12. Submission checklist

- [ ] Public repo, single README, `docker-compose up` works from a clean clone
- [ ] README includes setup, graph data model, and the Cypher queries and graph algorithms the product depends on
- [ ] AI coding assistant use disclosed; both members can explain schema, queries and architecture
- [ ] Data is public, synthetic or our own; any benchmark licenses listed
- [ ] Slice, path, ranking and fleet queries run in FalkorDB, not in-memory Python
- [ ] Main FalkorDB implementation written during the event (GradFlow is inspiration only)
- [ ] Track 1 named at submission; live deployment plus demo video
- [ ] Results table and limitations section written honestly
- [ ] FalkorDB features visible: multi-hop queries, per-tenant graphs, Browser view, MCP tools
- [ ] 90 s demo video, blog post published
- [ ] Submitted by early evening Oct 18

---

## 13. Repository layout

```
faultline/
  docker-compose.yml
  pyproject.toml
  faultline/
    recorder.py        tracked values, step and edge writer
    graph.py           schema, queries, fleet queries
    tools.py           MCP tools
    investigator.py    origin test loop
    judge.py           per-step judge with cache
    claims.py          claim extraction and support check
    patch.py           propose and apply patches
    replay.py          restore to step k and rerun
    llm.py             single model interface
  demo_agent/          agent.py, faults.py, checker.py
  eval/                baselines.py, run_eval.py, results/
  ui/                  index.html (cytoscape.js)
  README.md            the only doc
```

Code comment rule: comments state the problem, the fix and the result, and nothing else. No documentation files beyond the README.

---

## 14. Hour-1 checklist

- [ ] Confirm with Ishaan: one project, who owns recorder, graph and eval (Ankit) and demo agent, faults and UI (Ishaan)
- [ ] Re-read the Rules page for model, deployment and judging details
- [ ] Start FalkorDB in Docker and run a hello-world query
- [ ] Read Groq limits, list models, test tool calling on two candidates
- [ ] Record a 5-step toy run with the recorder and confirm native edges in FalkorDB Browser
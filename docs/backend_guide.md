# Backend Running & Operational Guide

This guide covers everything required to start, configure, operate, and query the FaultLine backend services.

---

## 1. Prerequisites

- **Python**: 3.11 or higher
- **Docker**: For running FalkorDB
- **Groq API Key**: Free tier supported for per-step judging and diagnosis

---

## 2. Environment Setup

Copy `.env.example` to `.env` and configure your keys:

```bash
cp .env.example .env
```

Key environment variables in `.env`:
```ini
# FalkorDB Connection
FALKORDB_HOST=localhost
FALKORDB_PORT=6379

# Graph Names
FALKORDB_GRAPH_DEMO=faultline_demo
FALKORDB_GRAPH_FLEET=faultline_fleet

# LLM Configuration (Groq / OpenAI compatible)
GROQ_API_KEY=gsk_your_actual_key_here
INVESTIGATOR_MODEL=llama-3.3-70b-versatile
JUDGE_MODEL=llama-3.1-8b-instant

# Server Configuration
API_PORT=8000
MCP_PORT=8001
```

---

## 3. Starting the FalkorDB Graph Store

FaultLine requires FalkorDB running as a container. Start it with Docker Compose:

```bash
docker compose up -d falkordb
```

Verify that FalkorDB is responding:
```bash
docker compose ps
# falkordb container should be in 'Up' status listening on port 6379
```

> [!TIP]
> FalkorDB provides a web-based Graph Browser UI at `http://localhost:3000` where you can visualize graphs, inspect nodes, and test Cypher queries interactively.

---

## 4. Running the Demo Agent (Generating Traces)

The demo agent simulates an enterprise multi-agent pipeline (`fetcher` $\to$ `cleaner` $\to$ `reporter`). It records step events and automatically commits the resulting graph directly into FalkorDB.

### Run a Clean Execution:
```bash
python -m demo_agent.agent
```

### Inject a Named Failure Fault:
```bash
# Data error: fetcher queries prior quarter table (wrong_table)
python -m demo_agent.agent --fault wrong_table

# Logic error: cleaner applies malformed regex parsing (bad_regex)
python -m demo_agent.agent --fault bad_regex

# External error: currency conversion rates are expired (stale_fx_rate)
python -m demo_agent.agent --fault stale_fx_rate

# Crash error: unhandled None in aggregator (unhandled_null)
python -m demo_agent.agent --fault unhandled_null

# Hallucination error: reporter invents fabricated revenue figures
python -m demo_agent.agent --fault hallucinate_numbers

# Hallucination error: reporter invents unauthorized office expansion
python -m demo_agent.agent --fault hallucinate_facts
```

Each run prints its generated `run_id` (e.g., `demo_a7e7b269`), execution status, and saves a JSON trace to `data/otel/<run_id>.json`.

---

## 5. Running the REST API Server

FaultLine provides a FastAPI backend for HTTP integrations:

```bash
uvicorn faultline.api:app --host 0.0.0.0 --port 8000 --reload
```

The API docs are available interactively at `http://localhost:8000/docs`.

### Key REST Endpoints

#### 1. Ingest Trace
- **`POST /ingest`**
- Body: `Trace` JSON
- Description: Ingests trace data and builds the graph in FalkorDB.

#### 2. Get Answer Flow
- **`GET /runs/{run_id}/flow`**
- Query params: `graph_name` (optional, defaults to `faultline_demo`)
- Returns the terminal answer text and the ordered upstream causal graph flow.
```bash
curl http://localhost:8000/runs/demo_a7e7b269/flow
```

#### 3. Extract & Check Claims
- **`POST /runs/{run_id}/claims/check`**
- Asynchronously extracts atomic claims from the answer and verifies each against upstream causal steps.
```bash
curl -X POST http://localhost:8000/runs/demo_a7e7b269/claims/check
```

#### 4. Run Forensics Investigation
- **`POST /investigate`**
- Body: `{"run_id": "demo_a7e7b269"}`
- Performs origin test, finds earliest broken step, suggests patch, and executes counterfactual replay.

#### 5. Fleet Summary
- **`GET /fleet`**
- Returns all known failure causes and affected runs across the fleet.

---

## 6. Running the FastMCP Tool Server

FaultLine exposes its tools over the Model Context Protocol (MCP) using [FastMCP](https://github.com/jlowin/fastmcp). External AI agents (Claude Code, Cursor, LangGraph) can connect to this server to query provenance and debug runs.

### Start the MCP Server (stdio transport for desktop agents):
```bash
python -m faultline.tools
```

### Configure in Claude Desktop or Cursor:
Add to `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "faultline": {
      "command": "python",
      "args": ["-m", "faultline.tools"],
      "cwd": "/path/to/faultline",
      "env": {
        "FALKORDB_HOST": "localhost",
        "FALKORDB_PORT": "6379"
      }
    }
  }
}
```

---

## 7. Running the CLI Investigator

You can run root-cause investigation directly from the command line:

```bash
# Investigate by local trace file
python -m faultline.investigator data/otel/demo_a7e7b269.json

# Or investigate by run ID in FalkorDB
python -m faultline.investigator demo_a7e7b269
```

Output:
```
============================================================
  FAULTLINE INVESTIGATION REPORT
============================================================
Run ID: demo_a7e7b269
Status: FAILED
Root Cause Step: #1 (fetcher / tool_call [query_warehouse])
Causal Path to Failure: 1 -> 2 -> 4
Confidence: 0.95
Explanation: Step #1 fetched sales_q2_apac instead of sales_q3_apac.
Proposed Patch: Correct warehouse query table parameter to sales_q3_apac.
Replay Verification: PASSED (Run restored to GREEN)
============================================================
```

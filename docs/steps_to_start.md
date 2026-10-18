# Steps to Start the Application

This is the definitive, step-by-step guide to starting and running the entire FaultLine system from a clean clone.

---

## ⚡ The 60-Second Quick Start

If you have Docker and Python installed:

```bash
# 1. Start FalkorDB
docker compose up -d falkordb

# 2. Setup environment and install dependencies
python3.11 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"

# 3. Configure API key
cp .env.example .env
# Open .env and insert your GROQ_API_KEY (free tier supported)

# 4. Generate initial demo traces & graphs
python -m demo_agent.agent --fault wrong_table

# 5. Launch the UI
streamlit run ui/app.py
```

Open `http://localhost:8501` in your browser. You're up and running!

---

## 📋 Comprehensive Step-by-Step Guide

### Step 1: Environment & Virtualenv Setup

FaultLine requires **Python 3.11**. Ensure you have Python 3.11 installed.

#### Option A: Using `uv` (Fastest)
```bash
# Install dependencies with uv
uv sync
source .venv/bin/activate
```

#### Option B: Using standard `pip`
```bash
python3.11 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -e ".[dev]"
```

Verify your environment:
```bash
python --version  # Should output Python 3.11.x
pytest tests/     # Verifies core packages are installed
```

---

### Step 2: Configure Environment Variables

Create your local `.env` configuration file from the template:

```bash
cp .env.example .env
```

Edit `.env` using your preferred text editor (e.g. `nano .env` or `code .env`):
```ini
# FalkorDB Database (default Docker settings)
FALKORDB_HOST=localhost
FALKORDB_PORT=6379
FALKORDB_GRAPH_DEMO=faultline_demo
FALKORDB_GRAPH_FLEET=faultline_fleet

# LLM Provider (Groq API free-tier supported)
GROQ_API_KEY=gsk_your_groq_api_key_here
INVESTIGATOR_MODEL=llama-3.3-70b-versatile
JUDGE_MODEL=llama-3.1-8b-instant

# Service Ports
API_PORT=8000
MCP_PORT=8001
```

> [!NOTE]
> You can obtain a free Groq API key at [console.groq.com](https://console.groq.com/keys).

---

### Step 3: Start the FalkorDB Graph Store

FaultLine uses [FalkorDB](https://www.falkordb.com/) as its central graph storage and Cypher query execution engine.

Start FalkorDB in Docker:
```bash
docker compose up -d falkordb
```

Check that the container is healthy:
```bash
docker compose ps
```
You should see:
```
NAME                 IMAGE                     COMMAND                  SERVICE     STATUS
faultline-falkordb   falkordb/falkordb:latest  "/entrypoint.sh falk…"   falkordb    Up (healthy)
```

- **Graph Database Port**: `localhost:6379`
- **FalkorDB Browser UI**: `http://localhost:3000` (optional web browser for querying Cypher directly)

---

### Step 4: Populate Data (Run the Demo Agent)

Run the instrumented demo agent to generate sample agent execution traces and automatically populate the FalkorDB graph:

#### 1. Generate a Clean Successful Run:
```bash
python -m demo_agent.agent
```

#### 2. Generate Runs with Fault Injections:
```bash
# Data fault: Fetcher queries previous quarter table
python -m demo_agent.agent --fault wrong_table

# Hallucination fault: Reporter invents fabricated numbers
python -m demo_agent.agent --fault hallucinate_numbers

# Logic fault: Cleaner uses malformed regex
python -m demo_agent.agent --fault bad_regex

# External fault: Stale currency conversion rates
python -m demo_agent.agent --fault stale_fx_rate
```

Each run prints its unique `run_id` (e.g., `demo_a7e7b269`), records its causal dependencies, and commits the graph into FalkorDB.

---

### Step 5: Launch the Streamlit Frontend

Start the interactive visual application:

```bash
streamlit run ui/app.py
```

The Streamlit UI will open at `http://localhost:8501`.

#### What to Try in the UI:
1. **Provenance Mode (Tab 1)**:
   - Select any run from the dropdown.
   - Inspect the terminal answer and the Claim Checker status badges.
   - Click any step in the timeline to view its inputs, outputs, and external data sources.
   - Interact with the Cytoscape graph visualization.
2. **Forensics Mode (Tab 2)**:
   - Select a failed run (e.g., `wrong_table`).
   - View the Origin Test diagnostics card identifying Step 1 as the true root cause.
   - Watch the causal path highlight in red on the graph canvas.
   - Click **"Run Replay Verification"** to apply the structured patch and watch the run recover to green.
3. **Fleet Mode (Tab 3)**:
   - View aggregated failure clusters across the fleet.
   - Click **"Batch Replay Affected Runs"** to verify fleet-wide repair.

---

### Step 6: (Optional) Launch Additional Services

#### A. FastAPI REST Server
If you want to integrate via REST or call endpoints externally:
```bash
uvicorn faultline.api:app --reload --port 8000
```
- API Docs: `http://localhost:8000/docs`
- Health check: `curl http://localhost:8000/health`
- Answer flow: `curl http://localhost:8000/runs/<run_id>/flow`

#### B. FastMCP Tool Server
If you want to expose FaultLine tools to external AI assistants (Cursor, Claude Code, LangGraph):
```bash
python -m faultline.tools
```
This runs FastMCP on stdio transport ready for client connections.

#### C. Run the Evaluation Benchmark
To run the automated benchmark comparing FaultLine against the flat log baseline:
```bash
python -m eval.run_eval --dataset demo --runs 20
```

---

## 🛠️ Handy Makefile Commands

If you prefer `make`, you can use these shortcuts:

| Command | Action |
|:---|:---|
| `make up` | Start FalkorDB container |
| `make down` | Stop all Docker containers |
| `make demo` | Run demo agent with a clean run |
| `make demo-fault` | Run demo agent with `wrong_table` fault |
| `make investigate` | Run CLI investigator on the latest trace |
| `make ui` | Launch Streamlit web interface |
| `make api` | Start FastAPI backend server |
| `make mcp` | Start FastMCP tool server |
| `make eval` | Run benchmark eval harness (20 runs) |
| `make demo-all` | Starts FalkorDB, injects fault, and launches UI in one command |

---

## 🔍 Troubleshooting & FAQs

### 1. "Cannot connect to FalkorDB on localhost:6379"
- Ensure Docker is running: `docker info`
- Start FalkorDB: `docker compose up -d falkordb`
- Note: If FalkorDB is offline, FaultLine automatically falls back to local JSON trace reading in `data/otel/` so you can still inspect runs.

### 2. "GROQ_API_KEY is not set"
- Ensure you created `.env` from `.env.example` and added your API key.
- Verify the key is loaded in your shell: `python -c "from faultline.config import settings; print(bool(settings.groq_api_key))"`

### 3. Port 8501 or 8000 Already in Use
- Specify a custom port for Streamlit: `streamlit run ui/app.py --server.port 8502`
- Specify a custom port for FastAPI: `uvicorn faultline.api:app --port 8005`

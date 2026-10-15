.PHONY: up down install demo investigate ui eval lint

## Start FalkorDB
up:
	docker compose up -d falkordb
	@echo "FalkorDB ready at localhost:6379 (Browser: http://localhost:3000)"

## Stop all services
down:
	docker compose down

## Install Python deps with uv
install:
	uv sync

## Run demo agent with a random fault (writes trace to data/otel/)
demo:
	python -m demo_agent.agent

## Run demo agent with a specific fault
demo-fault:
	python -m demo_agent.agent --fault wrong_table --seed 42

## Run investigator on latest OTel trace
investigate:
	@latest=$$(ls -t data/otel/*.json 2>/dev/null | head -1); \
	if [ -z "$$latest" ]; then echo "No traces found. Run 'make demo' first."; exit 1; fi; \
	python -m faultline.investigator $$latest

## Start Streamlit UI
ui:
	streamlit run ui/app.py

## Start FastAPI server
api:
	uvicorn faultline.api:app --reload --port 8000

## Start MCP tool server
mcp:
	python -m faultline.tools

## Run eval harness (20 runs, demo dataset)
eval:
	python -m eval.run_eval --dataset demo --runs 20

## Run eval harness (full, 50 runs)
eval-full:
	python -m eval.run_eval --dataset demo --runs 50

## Lint
lint:
	ruff check faultline/ demo_agent/ eval/
	mypy faultline/ --ignore-missing-imports

## Run everything for the demo (requires .env configured)
demo-all: up
	@echo "Generating demo trace..."
	python -m demo_agent.agent --fault wrong_table --seed 42
	@echo "Starting UI..."
	streamlit run ui/app.py

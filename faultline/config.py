"""
config.py — Single source of truth for runtime settings.

Reads from environment / .env file. Every other module imports from here;
nothing reads os.environ directly.
"""

from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # --- LLM ---
    groq_api_key: str = ""
    investigator_model: str = "qwen/qwen3.8-27b"
    judge_model: str = "qwen/qwen3.8-27b"

    # --- FalkorDB ---
    falkordb_host: str = "localhost"
    falkordb_port: int = 6379

    # One graph per dataset keeps tenants isolated. Cypher queries always scope
    # to a named graph so there's no cross-dataset contamination.
    graph_trail: str = "runs_trail"
    graph_demo: str = "runs_demo"

    # --- Algorithm knobs ---
    # How many hops backward to chase in backward_slice. 8 covers most real traces
    # without making the Cypher planner slow.
    slice_depth: int = 8

    # --- API server ---
    api_port: int = 8000

    # --- Cost / safety ---
    max_input_tokens: int = 6000
    cache_dir: str = ".cache/llm"

    def falkordb_url(self) -> str:
        return f"redis://{self.falkordb_host}:{self.falkordb_port}"


settings = Settings()

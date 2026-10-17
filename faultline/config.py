from __future__ import annotations

import os
from pathlib import Path
from dotenv import dotenv_values
from pydantic_settings import BaseSettings, SettingsConfigDict

# Ensure .env values take absolute priority over stale/malformed shell environment variables
_env_path = Path(__file__).resolve().parent.parent / ".env"
if _env_path.exists():
    _env_dict = dotenv_values(_env_path)
    if _env_dict.get("GROQ_API_KEY"):
        os.environ["GROQ_API_KEY"] = _env_dict["GROQ_API_KEY"]
    if _env_dict.get("INVESTIGATOR_MODEL"):
        os.environ["INVESTIGATOR_MODEL"] = _env_dict["INVESTIGATOR_MODEL"]
    if _env_dict.get("JUDGE_MODEL"):
        os.environ["JUDGE_MODEL"] = _env_dict["JUDGE_MODEL"]


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

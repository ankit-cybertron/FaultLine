"""
Unit test for Groq API integration and active models.
"""

import os
from pathlib import Path
from dotenv import dotenv_values
import pytest
from groq import Groq

@pytest.fixture(scope="session")
def groq_client():
    env_path = Path(__file__).resolve().parent.parent / ".env"
    env_vars = dotenv_values(env_path)
    api_key = env_vars.get("GROQ_API_KEY") or os.environ.get("GROQ_API_KEY")
    if not api_key:
        pytest.skip("GROQ_API_KEY not found in .env or environment")
    return Groq(api_key=api_key)

def test_groq_models_list(groq_client):
    """Verify that we can list models from Groq API."""
    models_resp = groq_client.models.list()
    assert models_resp.data, "Expected at least one model in Groq API"
    model_ids = [m.id for m in models_resp.data]
    assert "qwen/qwen3.8-27b" in model_ids, "qwen/qwen3.8-27b should be available"

def test_active_model_chat_completion(groq_client):
    """Test standard chat completion with the active model."""
    res = groq_client.chat.completions.create(
        model="qwen/qwen3.8-27b",
        messages=[{"role": "user", "content": "What is 2 + 2? Answer with only the digit."}],
        max_tokens=10,
        temperature=0.0
    )
    ans = res.choices[0].message.content.strip()
    assert "4" in ans

def test_active_model_json_mode(groq_client):
    """Test structured JSON mode required by FaultLine router."""
    res = groq_client.chat.completions.create(
        model="qwen/qwen3.8-27b",
        messages=[
            {"role": "system", "content": "You are a JSON generator. Respond only in JSON."},
            {"role": "user", "content": "Return a JSON object with key 'status' equal to 'ok'"}
        ],
        response_format={"type": "json_object"},
        max_tokens=20,
        temperature=0.0
    )
    import json
    data = json.loads(res.choices[0].message.content)
    assert data.get("status") == "ok"

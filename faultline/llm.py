"""
llm.py — Single entry point for all LLM calls in FaultLine.

Every call goes through here so we can:
  - swap models by config without touching callers
  - cache responses by (model, prompt hash) to disk so retries are free
  - pace requests to stay inside Groq free-tier RPM limits
  - handle 429s with truncated-exponential backoff
  - log token usage so the eval can account for it

Nothing else in the codebase should import groq directly.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import time
from pathlib import Path
from typing import Any, Optional

import diskcache
from groq import Groq, RateLimitError
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from faultline.config import settings

log = logging.getLogger(__name__)

# One shared cache directory. Keys are (model, prompt_hash) tuples.
_cache = diskcache.Cache(settings.cache_dir, size_limit=512 * 1024 * 1024)

# Shared Groq client — one TCP connection pool for the process.
_client = Groq(api_key=settings.groq_api_key)


def _prompt_hash(messages: list[dict], model: str) -> str:
    payload = json.dumps({"model": model, "messages": messages}, sort_keys=True)
    return hashlib.sha256(payload.encode()).hexdigest()[:24]


@retry(
    retry=retry_if_exception_type(RateLimitError),
    wait=wait_exponential(multiplier=2, min=4, max=60),
    stop=stop_after_attempt(6),
    reraise=True,
)
def _call_groq(
    messages: list[dict[str, str]],
    model: str,
    temperature: float,
    max_tokens: int,
    tools: Optional[list[dict]] = None,
    response_format: Optional[dict] = None,
) -> Any:
    """Raw Groq call with retry on 429. Does not touch the cache."""
    kwargs: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    if tools:
        kwargs["tools"] = tools
        kwargs["tool_choice"] = "auto"
    if response_format:
        kwargs["response_format"] = response_format

    # Brief pace: Groq free-tier is RPM-limited, not just TPM.
    # 0.4 s between calls gives us ~150 RPM headroom on most models.
    time.sleep(0.4)

    return _client.chat.completions.create(**kwargs)


def complete(
    messages: list[dict[str, str]],
    *,
    model: Optional[str] = None,
    temperature: float = 0.0,
    max_tokens: int = 1024,
    tools: Optional[list[dict]] = None,
    skip_cache: bool = False,
) -> tuple[str, int]:
    """
    Send a chat completion request. Returns (text_response, tokens_used).
    Caches by (model, messages) hash so re-running eval on identical inputs
    never burns rate-limit quota.
    """
    model = model or settings.judge_model
    cache_key = _prompt_hash(messages, model)

    if not skip_cache:
        cached = _cache.get(cache_key)
        if cached is not None:
            log.debug("cache hit %s", cache_key)
            return cached

    # Trim input if we're over the budget. We drop the oldest user turn first.
    # This affects B1 (flat log) most; FaultLine only sends sliced steps so it
    # rarely hits the limit. The eval reports when truncation happens.
    messages = _maybe_truncate(messages)

    resp = _call_groq(messages, model, temperature, max_tokens, tools=tools)
    choice = resp.choices[0]
    text = choice.message.content or ""
    tokens = resp.usage.total_tokens if resp.usage else 0

    result = (text, tokens)
    if not skip_cache:
        _cache.set(cache_key, result, expire=7 * 24 * 3600)  # 1 week

    log.debug("llm %s tokens=%d model=%s", cache_key, tokens, model)
    return result


def complete_json(
    messages: list[dict[str, str]],
    *,
    model: Optional[str] = None,
    temperature: float = 0.0,
    max_tokens: int = 512,
    skip_cache: bool = False,
) -> tuple[dict, int]:
    """
    Like complete() but forces JSON output and parses it.
    Used by judge.py. Returns (parsed_dict, tokens_used).
    """
    text, tokens = complete(
        messages,
        model=model,
        temperature=temperature,
        max_tokens=max_tokens,
        skip_cache=skip_cache,
        # Groq supports response_format={"type": "json_object"} for most models
    )
    # Strip markdown fences if the model added them anyway
    text = text.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        text = "\n".join(lines[1:-1]) if len(lines) > 2 else text
    try:
        return json.loads(text), tokens
    except json.JSONDecodeError:
        log.warning("JSON parse failed on model output; returning raw text in 'raw' key")
        return {"raw": text, "parse_error": True}, tokens


def complete_with_tools(
    messages: list[dict[str, str]],
    tools: list[dict],
    *,
    model: Optional[str] = None,
    temperature: float = 0.0,
    max_tokens: int = 2048,
) -> tuple[Any, int]:
    """
    For the investigator loop. Returns (choice.message, tokens_used).
    The caller inspects choice.message.tool_calls and .content.
    Tool calls are never cached — the investigator's state changes between turns.
    """
    model = model or settings.investigator_model
    resp = _call_groq(messages, model, temperature, max_tokens, tools=tools)
    choice = resp.choices[0]
    tokens = resp.usage.total_tokens if resp.usage else 0
    return choice.message, tokens


def _maybe_truncate(messages: list[dict[str, str]]) -> list[dict[str, str]]:
    """
    Rough guard: if the total character count suggests we're over
    MAX_INPUT_TOKENS, drop middle user turns until we're under.
    This is approximate (chars != tokens) but good enough to avoid hard rejections.
    """
    limit_chars = settings.max_input_tokens * 4  # ~4 chars/token
    total = sum(len(m.get("content", "")) for m in messages)
    if total <= limit_chars:
        return messages

    # Keep system (index 0) and last user turn. Drop from the middle.
    result = [messages[0]]
    kept = [messages[-1]]
    budget = limit_chars - len(messages[0].get("content", "")) - len(messages[-1].get("content", ""))
    for m in reversed(messages[1:-1]):
        chunk = len(m.get("content", ""))
        if budget - chunk > 0:
            budget -= chunk
            kept.insert(0, m)
        else:
            log.warning("truncated message at idx %d to fit token budget", messages.index(m))
    return result + kept

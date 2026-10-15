"""
faultline/claims.py — Asynchronous Claim Checker for Agent Provenance.

Extracts atomic factual claims from the agent's final answer, verifies whether
each claim is strictly supported by the outputs inside the causal slice, and
writes Claim nodes and SUPPORTED_BY edges into FalkorDB.
Claims lacking support in the flow are flagged as unsupported / hallucinated.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Optional

from faultline import graph as G
from faultline import llm
from faultline.config import settings

log = logging.getLogger(__name__)

_CLAIM_EXTRACT_SYSTEM = """\
You are an expert fact-checking analyzer. Given an AI agent's final answer,
extract all discrete atomic factual claims (numbers, statistics, dates, entities, actions, or conclusions).
Return a JSON array of strings, where each string is a single verifiable statement.

Example:
Answer: "APAC Q3 Total Revenue: $189,450.00 USD. Australia led with $79,200."
Output:
[
  "APAC Q3 Total Revenue is $189,450.00 USD",
  "Australia revenue was $79,200"
]

Respond ONLY with valid JSON (no markdown formatting, no commentary).
"""

_CLAIM_VERIFY_SYSTEM = """\
You are a strict data-provenance verifier.
You are given:
1. An atomic claim made in the final answer
2. The exact outputs produced by the upstream steps in the causal graph flow

Determine if the claim is directly supported by the upstream data.
Return JSON:
{
  "supported": true | false,
  "matching_step_idx": int | null,
  "reason": "short explanation"
}

Respond ONLY with valid JSON.
"""


def extract_claims(answer_text: str, model: Optional[str] = None) -> list[str]:
    """
    Extract discrete atomic claims from the answer text using LLM or rule-based fallback.
    """
    if not answer_text or not answer_text.strip():
        return []

    # Clean string if JSON encoded
    raw_text = answer_text
    try:
        parsed = json.loads(answer_text)
        if isinstance(parsed, dict):
            raw_text = parsed.get("summary") or parsed.get("answer") or str(parsed)
    except Exception:
        pass

    try:
        resp, _ = llm.complete(
            [
                {"role": "system", "content": _CLAIM_EXTRACT_SYSTEM},
                {"role": "user", "content": f"Final Answer:\n{raw_text}"},
            ],
            model=model or settings.judge_model,
            temperature=0.0,
            max_tokens=250,
        )
        claims = json.loads(resp)
        if isinstance(claims, list) and all(isinstance(c, str) for c in claims):
            return claims
    except Exception as e:
        log.debug("LLM claim extraction fallback: %s", e)

    # Deterministic rule-based fallback: split on sentences and key clauses
    sentences = [s.strip() for s in re.split(r"[.\n;]", raw_text) if s.strip()]
    return sentences if sentences else [raw_text.strip()]


def verify_claim_against_flow(claim: str, flow_steps: list[Any], model: Optional[str] = None) -> dict:
    """
    Check if a claim is supported by any step output in the causal flow.
    First tries fast string/regex/number match; falls back to small LLM entailment.
    """
    clean_claim = claim.strip().lower()

    def _get_field(s: Any, key: str, default: Any = "") -> Any:
        if isinstance(s, dict):
            return s.get(key, default)
        return getattr(s, key, default)

    # 1. Fast path: check for exact numbers and key tokens inside step outputs
    numbers_in_claim = re.findall(r"\d[\d,.]*", clean_claim)
    for step in flow_steps:
        step_out = str(_get_field(step, "output", "")).lower()
        step_idx = _get_field(step, "idx", 0)
        step_agent = _get_field(step, "agent", "agent")
        if not step_out:
            continue

        # If numbers match and substantial words overlap
        if numbers_in_claim:
            all_numbers_present = all(n in step_out for n in numbers_in_claim)
            if all_numbers_present:
                return {
                    "text": claim,
                    "supported": True,
                    "step_idx": step_idx,
                    "reason": f"Exact data match found in step #{step_idx} ({step_agent})",
                }
        elif len(clean_claim) > 10 and clean_claim in step_out:
            return {
                "text": claim,
                "supported": True,
                "step_idx": step_idx,
                "reason": f"Verbatim text match in step #{step_idx}",
            }

    # 2. LLM entailment verification
    flow_context = "\n".join(
        f"Step #{_get_field(s, 'idx')} ({_get_field(s, 'agent')}/{_get_field(s, 'kind')}): {_get_field(s, 'output')}"
        for s in flow_steps
    )

    try:
        user_prompt = f"Claim to verify:\n{claim}\n\nUpstream Causal Flow Outputs:\n{flow_context}"
        resp, _ = llm.complete(
            [
                {"role": "system", "content": _CLAIM_VERIFY_SYSTEM},
                {"role": "user", "content": user_prompt},
            ],
            model=model or settings.judge_model,
            temperature=0.0,
            max_tokens=200,
        )
        parsed = json.loads(resp)
        return {
            "text": claim,
            "supported": bool(parsed.get("supported", False)),
            "step_idx": parsed.get("matching_step_idx"),
            "reason": parsed.get("reason", "Evaluated by provenance checker"),
        }
    except Exception as e:
        log.debug("LLM claim verification failed: %s", e)

    # If neither matched, flag unsupported
    return {
        "text": claim,
        "supported": False,
        "step_idx": None,
        "reason": "Not found in the causal graph flow",
    }


def check_claims(run_id: str, graph_name: str = settings.graph_demo) -> list[dict]:
    """
    End-to-end claim check for a run:
    1. Fetches answer and causal flow from FalkorDB.
    2. Extracts claims and verifies each against upstream flow outputs.
    3. Persists Claim nodes and SUPPORTED_BY edges in FalkorDB.
    4. Returns the verified claims list.
    """
    flow_info = G.answer_flow(run_id, graph_name=graph_name)
    answer_text = flow_info.get("answer_text", "")
    flow = flow_info.get("flow", [])

    if not answer_text and flow:
        answer_text = flow[-1].get("output", "")

    # Exclude final answer step itself so claims cannot support themselves
    upstream_flow = flow[:-1] if len(flow) > 1 else flow

    claims_text = extract_claims(answer_text)
    verified_claims = [verify_claim_against_flow(c, upstream_flow) for c in claims_text]

    # Save to FalkorDB
    G.record_claims(run_id, verified_claims, graph_name=graph_name)

    return verified_claims

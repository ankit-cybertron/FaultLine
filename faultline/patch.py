"""
patch.py — Propose and apply structured patches to a failing step.

A patch is not "change the agent code" — it's a minimal structured intervention
that can be applied to the step's input before replay. Three kinds:

  prompt_edit   — change what the LLM was asked to do at that step
  arg_fix       — change a tool argument (wrong table name, bad filter, etc.)
  tool_config   — change a tool configuration value (timeout, schema version, etc.)

The LLM proposes the patch based on the root cause step and the diagnosis.
We output a Patch object so replay.py can apply it mechanically.
"""

from __future__ import annotations

import json
import logging
from typing import Optional

from faultline import llm
from faultline.config import settings
from faultline.ir import Diagnosis, Patch

log = logging.getLogger(__name__)

_PATCH_SYSTEM = """\
You are a patch engineer for AI agent systems. Given a failing step and a diagnosis,
propose the minimal fix that would correct the root cause.

Output valid JSON only (no markdown):
{
  "kind": "<prompt_edit | arg_fix | tool_config>",
  "diff": "<one sentence describing what changes>",
  "patched_input": <the complete corrected input dict as a JSON object, or null if not applicable>
}

Rules:
- Prefer arg_fix when the input has a wrong argument value (wrong table, wrong filter, wrong date).
- Prefer prompt_edit when the instruction to the LLM was ambiguous or wrong.
- Prefer tool_config when a tool setting caused the problem (cache_ttl, schema_version, etc.).
- The patched_input must be a complete replacement of the step's input — not a diff.
- If you can't determine a safe patch, use kind="prompt_edit" and patched_input=null.
"""


def propose_patch(
    diagnosis: Diagnosis,
    root_step_props: dict,
    model: Optional[str] = None,
) -> Patch:
    """
    Ask the LLM to propose a structured patch for the root cause step.

    Returns a Patch. The caller (replay.py) will apply it.
    """
    user_msg = (
        f"Diagnosis:\n{diagnosis.explanation}\n\n"
        f"Root cause step (idx={diagnosis.root_cause_idx}):\n"
        f"{json.dumps(root_step_props, indent=2)}\n\n"
        "Propose the minimal fix."
    )

    raw, tokens = llm.complete_json(
        [
            {"role": "system", "content": _PATCH_SYSTEM},
            {"role": "user", "content": user_msg},
        ],
        model=model or settings.investigator_model,
        temperature=0.1,
        max_tokens=512,
    )

    if raw.get("parse_error"):
        # Fallback: unknown patch, will be treated as a no-op by replay
        log.warning("patch proposal parse error for run=%s step=%d", diagnosis.run_id, diagnosis.root_cause_idx)
        return Patch(
            run_id=diagnosis.run_id,
            target_idx=diagnosis.root_cause_idx,
            kind="prompt_edit",
            diff="(parse error — manual review needed)",
            patched_input=None,
        )

    patched_input = raw.get("patched_input")
    if patched_input is not None and not isinstance(patched_input, str):
        patched_input = json.dumps(patched_input)

    return Patch(
        run_id=diagnosis.run_id,
        target_idx=diagnosis.root_cause_idx,
        kind=raw.get("kind", "prompt_edit"),  # type: ignore[arg-type]
        diff=raw.get("diff", ""),
        patched_input=patched_input,
    )

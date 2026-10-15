"""
demo_agent/checker.py — Task-level correctness checker for the demo pipeline.

The checker is the *external ground truth*: it looks at the final reporter
output and decides whether the overall task ("Summarise Q3 APAC sales") was
done correctly, independent of how the pipeline got there.

Used by:
  - The investigator to verify that a patched replay actually fixed the run.
  - The eval harness to label each trace as pass/fail without LLM involvement.

The checker is deterministic — it does NOT call an LLM. It checks structural
properties of the output that a correct Q3 APAC sales summary must have.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field


# ---------------------------------------------------------------------------
# expected properties of a correct Q3 APAC summary
# ---------------------------------------------------------------------------

# Q3 is Jul–Sep. Any date outside this range in the output signals a bad filter.
_Q3_MONTHS = {"july", "august", "september", "jul", "aug", "sep", "q3"}

# A correct report must have a total figure in AUD or USD (not both).
# We flag if we see both currency symbols together (currency mix fault).
_CURRENCY_RE = re.compile(r"(\$[0-9,]+|\baud\b|\busd\b)", re.IGNORECASE)

# Row count sanity: a non-zero sales figure must appear somewhere.
_NUMBER_RE = re.compile(r"\b\d[\d,]*\.?\d*\b")

# Table name leak: if the wrong table was used, the report sometimes reflects it.
_WRONG_QUARTER_RE = re.compile(r"\bq[124]\b|\bQ[124]\b", re.IGNORECASE)


@dataclass
class CheckResult:
    passed: bool
    reasons: list[str] = field(default_factory=list)  # why it failed (empty = passed)
    warnings: list[str] = field(default_factory=list)  # non-fatal oddities

    def __bool__(self) -> bool:
        return self.passed

    def summary(self) -> str:
        if self.passed:
            return "PASS" + (f" [{'; '.join(self.warnings)}]" if self.warnings else "")
        return "FAIL — " + "; ".join(self.reasons)


def check(output: str | None, fault_name: str = "no_fault") -> CheckResult:
    """
    Check whether *output* is an acceptable Q3 APAC sales summary.

    Args:
        output: The final string produced by the reporter step.
        fault_name: The injected fault (used to generate a better error message).

    Returns:
        CheckResult with passed=True iff the output looks correct.
    """
    reasons: list[str] = []
    warnings: list[str] = []

    if not output or len(output.strip()) < 20:
        reasons.append("output is empty or too short to be a real report")
        return CheckResult(passed=False, reasons=reasons)

    text = output.lower()

    # 1. Must reference Q3 somehow
    if not any(m in text for m in _Q3_MONTHS):
        reasons.append("no Q3 time reference found — report may cover wrong quarter")

    # 2. Must not leak wrong-quarter markers (Q1, Q2, Q4)
    if _WRONG_QUARTER_RE.search(output):
        reasons.append("wrong quarter marker found in output (Q1/Q2/Q4)")

    # 3. Must contain at least one number (sales figure)
    if not _NUMBER_RE.search(output):
        reasons.append("no numeric sales figure present — report is suspiciously empty")

    # 4. Currency mix check: both $ and AUD/USD in the same report is suspicious
    currencies = _CURRENCY_RE.findall(output)
    has_aud = any("aud" in c.lower() for c in currencies)
    has_usd = any("usd" in c.lower() or c.startswith("$") for c in currencies)
    if has_aud and has_usd:
        reasons.append("mixed currencies detected (AUD and USD) — conversion may have been skipped")

    # 5. If the verifier_blind fault was injected, the report may still pass
    # text checks even though the data is wrong — flag as warning only
    if fault_name == "verifier_blind" and not reasons:
        warnings.append("verifier_blind fault active — text checks passed but data integrity unverified")

    return CheckResult(passed=len(reasons) == 0, reasons=reasons, warnings=warnings)


def check_from_run(steps: list[dict], fault_name: str = "no_fault") -> CheckResult:
    """
    Convenience wrapper: extract the reporter step's output from a step list
    and run the check.

    Each step dict should have at least {'agent': str, 'output': str}.
    """
    reporter_output: str | None = None
    for step in reversed(steps):
        if step.get("agent") == "reporter" or step.get("kind") == "llm":
            reporter_output = step.get("output")
            break

    return check(reporter_output, fault_name=fault_name)

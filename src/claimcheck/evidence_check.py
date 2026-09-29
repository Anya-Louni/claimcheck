"""After the agent answers, check the report against real data, in code.

The model cannot be trusted to cite or copy correctly, so:
- claimed values are overwritten with what get_claims actually returned,
- a confirmed or contradicted verdict with no claim behind it becomes unclaimed,
- a confirmed or contradicted verdict whose evidence ids do not exist, or whose
  evidence is about another model, is downgraded to inconclusive.
Every correction is listed in unverified so the reader sees it.
"""

import json
from typing import Any

from langchain.agents.middleware import AgentMiddleware, AgentState
from langgraph.runtime import Runtime

from claimcheck import claims, evidence
from claimcheck.schemas import ProfileReport

STRONG = {"confirmed", "contradicted"}


def _text(value: Any) -> str | None:
    return None if value is None else json.dumps(value)


def _unclaimed(claim: Any) -> bool:
    return claim.claimed_langchain in (None, "null") and claim.claimed_models_dev in (None, "null")


def check_report(
    report: ProfileReport,
    claim_rows: list[dict[str, Any]] | None = None,
    lookup: Any = evidence.load,
) -> tuple[ProfileReport, list[str]]:
    """Return a corrected copy of the report and the problems found. Pure given its inputs."""
    rows = {row["field"]: row for row in claim_rows or []}
    problems: list[str] = []
    fixed_claims = []
    for claim in report.claims:
        row = rows.get(claim.field)
        if row is not None:
            actual = (_text(row["langchain"]), _text(row["models_dev"]))
            if (claim.claimed_langchain, claim.claimed_models_dev) != actual:
                problems.append(f"{claim.field}: claimed values corrected from get_claims data")
            claim = claim.model_copy(
                update={"claimed_langchain": actual[0], "claimed_models_dev": actual[1]}
            )
        if claim.verdict in STRONG and _unclaimed(claim):
            problems.append(f"{claim.field}: no source claims a value, verdict set to unclaimed")
            claim = claim.model_copy(update={"verdict": "unclaimed"})
        records = [lookup(eid) for eid in claim.evidence_ids]
        valid_ids = [
            eid
            for eid, r in zip(claim.evidence_ids, records, strict=True)
            if r and r.get("model", report.model) == report.model
        ]
        if claim.verdict in STRONG and not valid_ids:
            problems.append(
                f"{claim.field}: '{claim.verdict}' had no valid evidence ids, set to inconclusive"
            )
            claim = claim.model_copy(
                update={
                    "verdict": "inconclusive",
                    "note": claim.note + " (Downgraded: cited evidence could not be found.)",
                }
            )
        fixed_claims.append(claim.model_copy(update={"evidence_ids": valid_ids}))
    fixed = report.model_copy(
        update={"claims": fixed_claims, "unverified": report.unverified + problems}
    )
    return fixed, problems


class EvidenceCheckMiddleware(AgentMiddleware):
    """Runs check_report on the structured response when the agent finishes."""

    def after_agent(self, state: AgentState, runtime: Runtime) -> dict[str, Any] | None:
        report = state.get("structured_response")
        if not isinstance(report, ProfileReport):
            return None
        try:
            data = claims.get_claims_data(report.provider, report.model)
        except Exception:  # an unknown model or provider leaves nothing to compare
            data = {}
        fixed, problems = check_report(report, data.get("claims"))
        if data.get("integration"):
            fixed = fixed.model_copy(update={"integration_version": data["integration"]})
        from claimcheck.budget import _emit

        _emit({"type": "evidence_check", "problems": problems, "claims": len(fixed.claims)})
        return {"structured_response": fixed}

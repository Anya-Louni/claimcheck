"""After the agent answers, check the report against real data, in code.

The model writes the report, but it cannot be trusted to copy values or apply
the verdict rules exactly. So this middleware:
- overwrites claimed values with what get_claims actually returned,
- drops evidence ids that do not exist or belong to another model,
- recomputes the verdict from the cited evidence whenever evidence exists
  (probe trials vote; metadata values are compared directly),
- downgrades a confirmed or contradicted verdict with no usable evidence to
  inconclusive, and one with no claim behind it to unclaimed.
Every change is listed in unverified so the reader can see it.
"""

import json
from typing import Any, get_args

from langchain.agents.middleware import AgentMiddleware, AgentState
from langchain_core.messages import ToolMessage
from langgraph.runtime import Runtime

from claimcheck import claims, evidence
from claimcheck.probes.base import majority
from claimcheck.schemas import ClaimVerdict, FieldName, ProfileReport

STRONG = {"confirmed", "contradicted"}


def _text(value: Any) -> str | None:
    return None if value is None else json.dumps(value)


def _parse(text: str | None) -> Any:
    if text is None or text.strip().lower() in ("", "null", "none"):
        return None
    try:
        return json.loads(text.strip().lower())
    except json.JSONDecodeError:
        return text


def _claimed(claim: ClaimVerdict) -> Any:
    """The value LangChain acts on, or the models.dev value when LangChain has none."""
    lc = _parse(claim.claimed_langchain)
    return lc if lc is not None else _parse(claim.claimed_models_dev)


def observed_value(field: str, records: list[dict[str, Any]]) -> Any:
    """Derive what the evidence shows: True/False from probe votes, a number from metadata.

    Returns None when the evidence does not settle it. Langchain-path trials are
    preferred, since the claim is about what LangChain users get.
    """
    meta = [r for r in records if r.get("kind") == "metadata"]
    if meta and field in meta[0].get("response", {}):
        return meta[0]["response"][field]
    probes = [r for r in records if r.get("kind") == "probe" and r.get("capability") == field]
    chosen = [r for r in probes if r.get("path") == "langchain"] or probes
    if not chosen:
        return None
    votes = [r.get("passed") for r in chosen]
    outcome = majority(votes.count(True), votes.count(False), votes.count(None))
    return {"pass": True, "fail": False}.get(outcome)


def _check_claim(
    claim: ClaimVerdict, row: dict[str, Any] | None, records: dict[str, Any], model: str
) -> tuple[ClaimVerdict, list[str]]:
    problems: list[str] = []
    if row is not None:
        actual = (_text(row["langchain"]), _text(row["models_dev"]))
        written = (_parse(claim.claimed_langchain), _parse(claim.claimed_models_dev))
        if written != (row["langchain"], row["models_dev"]):
            problems.append(f"{claim.field}: claimed values corrected from get_claims data")
        claim = claim.model_copy(
            update={"claimed_langchain": actual[0], "claimed_models_dev": actual[1]}
        )
    valid = {
        eid: records[eid]
        for eid in claim.evidence_ids
        if records.get(eid) and records[eid].get("model", model) == model
    }
    claim = claim.model_copy(update={"evidence_ids": list(valid)})
    claimed = _claimed(claim)
    observed = observed_value(claim.field, list(valid.values()))
    verdict = claim.verdict
    if claimed is None:
        if verdict in STRONG:
            verdict = "unclaimed"
    elif observed is not None:
        verdict = "confirmed" if observed == claimed else "contradicted"
    elif verdict in STRONG:
        verdict = "inconclusive"
    if row is not None and row.get("missing_in_langchain") and claim.layer != "data":
        claim = claim.model_copy(
            update={
                "layer": "data",
                "note": claim.note + " The LangChain profile has no value here, "
                "while models.dev does, so the package data is stale.",
            }
        )
    if verdict != claim.verdict:
        problems.append(f"{claim.field}: verdict '{claim.verdict}' recomputed as '{verdict}'")
        update: dict[str, Any] = {"verdict": verdict}
        if verdict == "confirmed":
            update["layer"] = "none"
        claim = claim.model_copy(update=update)
    return claim, problems


def run_evidence(messages: list[Any]) -> dict[str, list[str]]:
    """Map each field to the evidence ids the run's own tool results produced. Pure."""
    found: dict[str, list[str]] = {}
    for message in messages:
        if not isinstance(message, ToolMessage):
            continue
        try:
            data = json.loads(message.text)
        except (json.JSONDecodeError, TypeError):
            continue
        if not isinstance(data, dict):
            continue
        if data.get("path") == "langchain" and data.get("capability") and data.get("evidence_ids"):
            found[data["capability"]] = [e for e in data["evidence_ids"] if e]
        if "max_input_tokens" in data and data.get("evidence_id"):
            found["max_input_tokens"] = found["max_output_tokens"] = [data["evidence_id"]]
    return found


def fill_missing(
    report: ProfileReport, found: dict[str, list[str]], lookup: Any = evidence.load
) -> tuple[ProfileReport, list[str]]:
    """Add a row for every field the run measured but the report left out. Pure given lookup."""
    present = {c.field for c in report.claims}
    added: list[ClaimVerdict] = []
    notes: list[str] = []
    for field in get_args(FieldName):
        ids = found.get(field)
        if field in present or not ids:
            continue
        records = [r for r in map(lookup, ids) if r]
        value = observed_value(field, records)
        if isinstance(value, int) and not isinstance(value, bool):
            observed = f"{value} tokens"
        else:
            passes = sum(r.get("passed") is True for r in records)
            observed = f"{passes}/{len(records)} pass"
        added.append(
            ClaimVerdict(
                field=field,
                claimed_langchain=None,
                claimed_models_dev=None,
                observed=observed,
                verdict="inconclusive",
                layer="none",
                evidence_ids=ids,
                note="Added by the evidence check: the report left this field out.",
            )
        )
        notes.append(f"{field}: missing from the report, added from this run's evidence")
    if not added:
        return report, notes
    return report.model_copy(update={"claims": [*report.claims, *added]}), notes


def check_report(
    report: ProfileReport,
    claim_rows: list[dict[str, Any]] | None = None,
    lookup: Any = evidence.load,
) -> tuple[ProfileReport, list[str]]:
    """Return a corrected copy of the report and the problems found. Pure given its inputs."""
    rows = {row["field"]: row for row in claim_rows or []}
    ids = {eid for c in report.claims for eid in c.evidence_ids}
    records = {eid: lookup(eid) for eid in ids}
    problems: list[str] = []
    fixed_claims = []
    for claim in report.claims:
        fixed, found = _check_claim(claim, rows.get(claim.field), records, report.model)
        fixed_claims.append(fixed)
        problems.extend(found)
    fixed_report = report.model_copy(
        update={"claims": fixed_claims, "unverified": report.unverified + problems}
    )
    return fixed_report, problems


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
        report, added = fill_missing(report, run_evidence(state["messages"]))
        fixed, problems = check_report(report, data.get("claims"))
        problems = added + problems
        fixed = fixed.model_copy(update={"unverified": added + fixed.unverified})
        if data.get("integration"):
            fixed = fixed.model_copy(update={"integration_version": data["integration"]})
        from claimcheck.budget import emit

        emit({"type": "evidence_check", "problems": problems, "claims": len(fixed.claims)})
        return {"structured_response": fixed}

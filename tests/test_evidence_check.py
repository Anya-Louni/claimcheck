from claimcheck.evidence_check import check_report
from claimcheck.schemas import ClaimVerdict, ProfileReport

RECORDS = {"probe-a": {"model": "m"}, "probe-other": {"model": "other"}}


def _report(**claim: object) -> ProfileReport:
    base = {
        "field": "tool_choice",
        "claimed_langchain": "true",
        "claimed_models_dev": "true",
        "observed": "3/3 pass",
        "verdict": "confirmed",
        "layer": "none",
        "evidence_ids": ["probe-a"],
        "note": "ok",
    }
    return ProfileReport(
        provider="google_genai",
        model="m",
        integration_version="x",
        scope_note="",
        claims=[ClaimVerdict(**{**base, **claim})],
        draft_change_id=None,
        unverified=[],
        summary="",
    )


def test_claimed_values_are_taken_from_real_data() -> None:
    rows = [{"field": "tool_choice", "langchain": True, "models_dev": None}]
    fixed, problems = check_report(_report(), rows, RECORDS.get)
    claim = fixed.claims[0]
    assert (claim.claimed_langchain, claim.claimed_models_dev) == ("true", None)
    assert claim.verdict == "confirmed"
    assert problems == ["tool_choice: claimed values corrected from get_claims data"]


def test_confirmed_without_any_claim_becomes_unclaimed() -> None:
    rows = [{"field": "tool_choice", "langchain": None, "models_dev": None}]
    fixed, _ = check_report(_report(), rows, RECORDS.get)
    assert fixed.claims[0].verdict == "unclaimed"


def test_other_model_evidence_is_dropped() -> None:
    fixed, problems = check_report(_report(evidence_ids=["probe-other"]), None, RECORDS.get)
    assert fixed.claims[0].verdict == "inconclusive"
    assert fixed.claims[0].evidence_ids == []
    assert fixed.unverified == problems


def test_clean_report_is_unchanged() -> None:
    rows = [{"field": "tool_choice", "langchain": True, "models_dev": True}]
    report = _report()
    fixed, problems = check_report(report, rows, RECORDS.get)
    assert problems == [] and fixed == report

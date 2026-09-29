from typing import Any

from claimcheck.evidence_check import check_report, observed_value
from claimcheck.schemas import ClaimVerdict, ProfileReport


def _probe(passed: bool | None, capability: str = "audio_inputs", model: str = "m") -> dict:
    return {
        "kind": "probe",
        "model": model,
        "capability": capability,
        "path": "langchain",
        "passed": passed,
    }


RECORDS: dict[str, Any] = {
    "pass-1": _probe(True),
    "pass-2": _probe(True),
    "fail-1": _probe(False),
    "fail-2": _probe(False),
    "err-1": _probe(None),
    "other": _probe(True, model="other"),
    "meta": {"kind": "metadata", "model": "m", "response": {"max_input_tokens": 1000}},
}


def _report(**claim: Any) -> ProfileReport:
    base = {
        "field": "audio_inputs",
        "claimed_langchain": "true",
        "claimed_models_dev": "true",
        "observed": "",
        "verdict": "confirmed",
        "layer": "none",
        "evidence_ids": ["pass-1", "pass-2"],
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


def _row(lc: Any, md: Any, field: str = "audio_inputs") -> list[dict[str, Any]]:
    return [{"field": field, "langchain": lc, "models_dev": md}]


def test_observed_value_votes_and_reads_metadata() -> None:
    assert observed_value("audio_inputs", [RECORDS["pass-1"], RECORDS["fail-1"], RECORDS["pass-2"]])
    assert observed_value("audio_inputs", [RECORDS["fail-1"], RECORDS["fail-2"]]) is False
    assert observed_value("audio_inputs", [RECORDS["err-1"]]) is None
    assert observed_value("max_input_tokens", [RECORDS["meta"]]) == 1000


def test_false_claim_that_fails_is_confirmed() -> None:
    report = _report(
        claimed_langchain="false",
        claimed_models_dev="false",
        verdict="contradicted",
        layer="model",
        evidence_ids=["fail-1", "fail-2"],
    )
    fixed, problems = check_report(report, _row(False, False), RECORDS.get)
    assert fixed.claims[0].verdict == "confirmed"
    assert fixed.claims[0].layer == "none"
    assert problems == ["audio_inputs: verdict 'contradicted' recomputed as 'confirmed'"]


def test_true_claim_that_fails_is_contradicted() -> None:
    report = _report(evidence_ids=["fail-1", "fail-2"])
    fixed, _ = check_report(report, _row(True, True), RECORDS.get)
    assert fixed.claims[0].verdict == "contradicted"


def test_metadata_mismatch_is_contradicted() -> None:
    report = _report(
        field="max_input_tokens",
        claimed_langchain="2000",
        claimed_models_dev="2000",
        evidence_ids=["meta"],
    )
    fixed, _ = check_report(report, _row(2000, 2000, "max_input_tokens"), RECORDS.get)
    assert fixed.claims[0].verdict == "contradicted"


def test_claimed_values_come_from_real_data() -> None:
    fixed, problems = check_report(_report(), _row(True, None), RECORDS.get)
    claim = fixed.claims[0]
    assert (claim.claimed_langchain, claim.claimed_models_dev) == ("true", None)
    assert claim.verdict == "confirmed"
    assert problems == ["audio_inputs: claimed values corrected from get_claims data"]


def test_null_text_is_not_reported_as_a_correction() -> None:
    report = _report(claimed_models_dev="null")
    _, problems = check_report(report, _row(True, None), RECORDS.get)
    assert problems == []


def test_confirmed_without_any_claim_becomes_unclaimed() -> None:
    fixed, _ = check_report(_report(), _row(None, None), RECORDS.get)
    assert fixed.claims[0].verdict == "unclaimed"


def test_invented_or_foreign_evidence_is_dropped() -> None:
    fixed, problems = check_report(_report(evidence_ids=["other", "made-up"]), None, RECORDS.get)
    assert fixed.claims[0].verdict == "inconclusive"
    assert fixed.claims[0].evidence_ids == []
    assert fixed.unverified == problems


def test_errors_only_make_it_inconclusive() -> None:
    fixed, _ = check_report(_report(evidence_ids=["err-1"]), _row(True, True), RECORDS.get)
    assert fixed.claims[0].verdict == "inconclusive"


def test_clean_report_is_unchanged() -> None:
    report = _report()
    fixed, problems = check_report(report, _row(True, True), RECORDS.get)
    assert problems == [] and fixed == report

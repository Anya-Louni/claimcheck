from pathlib import Path

import pytest

from claimcheck.claims import (
    OutOfScope,
    get_claims_data,
    merge_claims,
    models_dev_claims,
    resolve_provider,
)

RECORD = {
    "tool_call": True,
    "structured_output": True,
    "modalities": {"input": ["text", "image"], "output": ["text"]},
    "limit": {"context": 1048576, "output": 65536},
}


def test_models_dev_mapping() -> None:
    claims = models_dev_claims(RECORD)
    assert claims == {
        "tool_calling": True,
        "structured_output": True,
        "image_inputs": True,
        "audio_inputs": False,
        "max_input_tokens": 1048576,
        "max_output_tokens": 65536,
    }
    assert models_dev_claims(None) == {}


def test_input_limit_preferred_over_context() -> None:
    record = {**RECORD, "limit": {"context": 200, "input": 150, "output": 10}}
    assert models_dev_claims(record)["max_input_tokens"] == 150


def test_merge_flags_missing_and_disagreement() -> None:
    rows = {r["field"]: r for r in merge_claims({"audio_inputs": True}, models_dev_claims(RECORD))}
    assert rows["tool_calling"]["missing_in_langchain"] is True
    assert rows["audio_inputs"]["sources_agree"] is False
    assert rows["tool_choice"]["langchain"] is None and rows["tool_choice"]["models_dev"] is None


def test_resolve_provider_aliases_and_scope() -> None:
    assert resolve_provider("Gemini").langchain_id == "google_genai"
    assert resolve_provider("google-genai").models_dev_id == "google"
    with pytest.raises(OutOfScope, match="no free API access"):
        resolve_provider("openai")


SNAPSHOT = Path(__file__).parents[1] / "evals" / "fixtures" / "models_dev_api.json"


def test_unknown_model_suggests_close_ids(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CLAIMCHECK_MODELS_DEV_SNAPSHOT", str(SNAPSHOT))
    data = get_claims_data("google", "gemma-4-26b")
    assert data["known"] is False
    assert "gemma-4-26b-a4b-it" in data["did_you_mean"]


def test_known_model_has_probe_plan(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CLAIMCHECK_MODELS_DEV_SNAPSHOT", str(SNAPSHOT))
    data = get_claims_data("google", "gemini-3.8-flash")
    assert data["langchain_profile_empty"] is True
    assert "probe_audio_input" in data["probe_plan"]
    rows = {r["field"]: r for r in data["claims"]}
    assert rows["tool_calling"]["missing_in_langchain"] is True

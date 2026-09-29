"""Read claimed capabilities from a LangChain profile and from models.dev.

The mapping from models.dev fields to LangChain profile keys follows the
langchain-profiles generator: tool_call -> tool_calling, modalities.input ->
*_inputs, limit.context/limit.input -> max_input_tokens, limit.output ->
max_output_tokens.
"""

import difflib
import json
import os
import time
from dataclasses import dataclass
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Any

import httpx

from claimcheck.config import settings

MODELS_DEV_URL = "https://models.dev/api.json"
CACHE_PATH = settings.data_dir / "models_dev_api.json"
CACHE_SECONDS = 6 * 3600

PROBE_PLAN = [
    "probe_tool_calling",
    "probe_tool_choice",
    "probe_parallel_tool_calls",
    "probe_structured_output",
    "probe_image_input",
    "probe_audio_input",
    "check_provider_limits",
]

CLAIM_FIELDS = (
    "tool_calling",
    "tool_choice",
    "structured_output",
    "image_inputs",
    "audio_inputs",
    "max_input_tokens",
    "max_output_tokens",
)


@dataclass(frozen=True)
class Provider:
    """A provider in scope and where its data and docs live."""

    langchain_id: str
    models_dev_id: str
    package: str
    doc_domains: tuple[str, ...]


PROVIDERS = {
    "google_genai": Provider(
        langchain_id="google_genai",
        models_dev_id="google",
        package="langchain-google-genai",
        doc_domains=("ai.google.dev",),
    ),
}

OUT_OF_SCOPE = {
    "openai": "no free API access",
    "google_vertexai": "needs a billed Google Cloud project",
}


class OutOfScope(ValueError):
    """Raised for providers this deployment cannot probe."""


def resolve_provider(name: str) -> Provider:
    """Map user input like "google", "gemini" or "google_genai" to a provider in scope."""
    key = name.strip().lower().replace("-", "_")
    aliases = {"google": "google_genai", "gemini": "google_genai"}
    key = aliases.get(key, key)
    if key in PROVIDERS:
        return PROVIDERS[key]
    reason = OUT_OF_SCOPE.get(key, "no integration installed and no free key configured")
    raise OutOfScope(f"provider '{name}' is out of scope: {reason}")


def models_dev_claims(record: dict[str, Any] | None) -> dict[str, Any]:
    """Convert one models.dev model record to profile-style claims. Pure."""
    if not record:
        return {}
    inputs = record.get("modalities", {}).get("input", [])
    limit = record.get("limit", {})
    claims = {
        "tool_calling": record.get("tool_call"),
        "structured_output": record.get("structured_output"),
        "image_inputs": "image" in inputs if inputs else None,
        "audio_inputs": "audio" in inputs if inputs else None,
        "max_input_tokens": limit.get("input") or limit.get("context"),
        "max_output_tokens": limit.get("output"),
    }
    return {k: v for k, v in claims.items() if v is not None}


def merge_claims(langchain: dict[str, Any], models_dev: dict[str, Any]) -> list[dict[str, Any]]:
    """Line up both sources per field and flag where they disagree. Pure."""
    rows = []
    for field in CLAIM_FIELDS:
        lc, md = langchain.get(field), models_dev.get(field)
        rows.append(
            {
                "field": field,
                "langchain": lc,
                "models_dev": md,
                "sources_agree": lc == md or lc is None or md is None,
                "missing_in_langchain": lc is None and md is not None,
            }
        )
    return rows


def fetch_models_dev(path: Path = CACHE_PATH) -> dict[str, Any]:
    """Return the models.dev catalog, cached on disk for a few hours.

    CLAIMCHECK_MODELS_DEV_SNAPSHOT pins a saved copy, so evals are repeatable.
    """
    snapshot = os.getenv("CLAIMCHECK_MODELS_DEV_SNAPSHOT")
    if snapshot:
        return json.loads(Path(snapshot).read_text(encoding="utf-8"))
    if path.exists() and time.time() - path.stat().st_mtime < CACHE_SECONDS:
        return json.loads(path.read_text(encoding="utf-8"))
    response = httpx.get(MODELS_DEV_URL, timeout=30, follow_redirects=True)
    response.raise_for_status()
    path.write_text(response.text, encoding="utf-8")
    return response.json()


def langchain_profile(provider: Provider, model: str) -> dict[str, Any]:
    """Return the profile the installed integration assigns to this model."""
    from claimcheck.models import make_model

    chat_model = make_model(f"{provider.langchain_id}:{model}")
    return dict(chat_model.profile or {})


def integration_version(provider: Provider) -> str:
    """Return the installed integration package version."""
    try:
        return version(provider.package)
    except PackageNotFoundError:
        return "not installed"


def get_claims_data(provider_name: str, model: str) -> dict[str, Any]:
    """Collect claims for one model from both sources."""
    provider = resolve_provider(provider_name)
    catalog = fetch_models_dev()
    known = catalog.get(provider.models_dev_id, {}).get("models", {})
    record = known.get(model)
    profile = langchain_profile(provider, model)
    if record is None and not profile:
        return {
            "provider": provider.langchain_id,
            "model": model,
            "known": False,
            "did_you_mean": difflib.get_close_matches(model, list(known), n=3, cutoff=0.5),
            "next_step": "Do not probe. Ask the user to confirm the exact model id.",
        }
    return {
        "provider": provider.langchain_id,
        "model": model,
        "integration": f"{provider.package}=={integration_version(provider)}",
        "in_models_dev": record is not None,
        "langchain_profile_empty": not profile,
        "claims": merge_claims(
            {k: profile.get(k) for k in CLAIM_FIELDS}, models_dev_claims(record)
        ),
        "models_dev_url": f"https://models.dev/api.json#{provider.models_dev_id}/{model}",
        "probe_plan": PROBE_PLAN,
    }

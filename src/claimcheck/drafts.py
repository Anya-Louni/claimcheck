"""Draft a models.dev data change as a unified diff plus a pull request description.

The draft is only written to disk for review. Nothing is ever submitted.
"""

import difflib
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import httpx
import tomlkit

from claimcheck import evidence
from claimcheck.claims import resolve_provider
from claimcheck.config import settings

RAW_BASE = "https://raw.githubusercontent.com/anomalyco/models.dev/dev"
DRAFT_DIR = settings.data_dir / "drafts"
EDITABLE = {
    "tool_calling",
    "structured_output",
    "image_inputs",
    "audio_inputs",
    "max_output_tokens",
}


@dataclass
class Change:
    field: str
    value: Any
    evidence_ids: list[str]


def check_changes(
    changes: list[Change],
    model: str,
    models_dev_values: dict[str, Any],
    lookup: Callable[[str], dict[str, Any] | None],
) -> list[str]:
    """Return reasons to refuse the draft. Empty means every change is backed. Pure.

    A change is backed when its cited evidence is about this model, shows the
    new value, and models.dev currently says something else.
    """
    from claimcheck.evidence_check import observed_value

    problems = []
    for change in changes:
        if change.field not in EDITABLE:
            problems.append(f"{change.field}: not a models.dev field this tool can edit")
            continue
        records = [r for r in map(lookup, change.evidence_ids) if r and r.get("model") == model]
        observed = observed_value(change.field, records)
        if observed is None:
            problems.append(f"{change.field}: cited evidence does not settle the value")
        elif observed != change.value:
            problems.append(f"{change.field}: evidence shows {observed}, not {change.value}")
        elif models_dev_values.get(change.field) == change.value:
            problems.append(f"{change.field}: models.dev already says {change.value}")
    return problems


def apply_change(doc: tomlkit.TOMLDocument, change: Change) -> None:
    """Apply one profile-style change to a models.dev TOML document in place. Pure."""
    if change.field == "tool_calling":
        doc["tool_call"] = bool(change.value)
    elif change.field == "structured_output":
        doc["structured_output"] = bool(change.value)
    elif change.field in ("image_inputs", "audio_inputs"):
        kind = change.field.removesuffix("_inputs")
        modalities = doc.setdefault("modalities", tomlkit.table())
        inputs = list(modalities.get("input", ["text"]))
        if change.value and kind not in inputs:
            inputs.append(kind)
        if not change.value and kind in inputs:
            inputs.remove(kind)
        modalities["input"] = inputs
    elif change.field == "max_output_tokens":
        doc.setdefault("limit", tomlkit.table())["output"] = int(change.value)
    else:
        raise ValueError(f"{change.field} has no models.dev field this tool can edit")


def unified_diff(path: str, before: str, after: str) -> str:
    """Return a git-style diff for one file. Pure."""
    lines = difflib.unified_diff(
        before.splitlines(keepends=True),
        after.splitlines(keepends=True),
        fromfile=f"a/{path}",
        tofile=f"b/{path}",
    )
    return "".join(lines)


def pr_description(model: str, changes: list[Change], layer_notes: str) -> str:
    """Write a short pull request description that links every change to evidence."""
    rows = "\n".join(
        f"- `{c.field}` -> `{c.value}`. Evidence: {', '.join(c.evidence_ids)}" for c in changes
    )
    return (
        f"## Correct capability data for {model}\n\n"
        f"{rows}\n\n"
        "### How this was checked\n"
        "Each capability was probed three times through the provider API with a fixed "
        "input and a known answer. Transcripts are attached for every trial.\n\n"
        f"### Notes\n{layer_notes}\n"
    )


def draft_change(
    provider: str, model: str, changes: list[Change], layer_notes: str
) -> dict[str, Any]:
    """Fetch the current models.dev TOML for the model, apply changes, save a draft."""
    unknown = [c.field for c in changes if c.field not in EDITABLE]
    if unknown:
        raise ValueError(f"fields not editable in models.dev: {unknown}")
    prov = resolve_provider(provider)
    path = f"models/{prov.models_dev_id}/{model}.toml"
    response = httpx.get(f"{RAW_BASE}/{path}", timeout=30)
    if response.status_code != 200:
        raise FileNotFoundError(f"{path} not found in models.dev ({response.status_code})")
    before = response.text
    doc = tomlkit.parse(before)
    for change in changes:
        apply_change(doc, change)
    diff = unified_diff(path, before, tomlkit.dumps(doc))
    body = pr_description(model, changes, layer_notes)
    draft_id = evidence.save(
        "draft",
        {"target": "models.dev", "path": path, "diff": diff, "description": body},
        directory=DRAFT_DIR,
    )
    return {"draft_id": draft_id, "path": path, "diff": diff, "description": body}

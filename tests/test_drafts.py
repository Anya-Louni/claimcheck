from pathlib import Path

import pytest
import tomlkit

from claimcheck.drafts import Change, apply_change, pr_description, unified_diff

SOURCE = (Path(__file__).parent / "fixtures" / "gemini-test.toml").read_text()


def test_apply_changes_keeps_formatting() -> None:
    doc = tomlkit.parse(SOURCE)
    apply_change(doc, Change("audio_inputs", False, ["probe-1"]))
    apply_change(doc, Change("structured_output", False, ["probe-2"]))
    out = tomlkit.dumps(doc)
    assert 'input = ["text", "image"]' in out
    assert "structured_output = false" in out
    assert "context = 1_048_576" in out  # untouched lines stay as written


def test_diff_only_touches_changed_lines() -> None:
    doc = tomlkit.parse(SOURCE)
    apply_change(doc, Change("tool_calling", False, ["probe-1"]))
    diff = unified_diff("models/google/x.toml", SOURCE, tomlkit.dumps(doc))
    changed = [
        line
        for line in diff.splitlines()
        if line[:1] in "+-" and not line.startswith(("+++", "---"))
    ]
    assert changed == ["-tool_call = true", "+tool_call = false"]


def test_rejects_fields_without_models_dev_key() -> None:
    with pytest.raises(ValueError):
        apply_change(tomlkit.parse(SOURCE), Change("tool_choice", False, []))


def test_pr_description_cites_evidence() -> None:
    text = pr_description(
        "gemini-test", [Change("audio_inputs", False, ["probe-a", "probe-b"])], "notes"
    )
    assert "probe-a, probe-b" in text and "gemini-test" in text

"""Turn evidence from real probe runs into replay recordings for the evals.

Nothing is invented: each recording is rebuilt from the saved transcripts of
live trials, and the transcripts are copied next to it.

Usage:
    uv run python scripts/export_recordings.py gemini-3.5-flash-lite gemma-4-26b-a4b-it
"""

import json
import shutil
import sys
from collections import defaultdict

from claimcheck.config import ROOT, settings
from claimcheck.probes.base import majority

SOURCE = settings.data_dir / "evidence"
OUT = ROOT / "evals" / "recordings"
TRIALS = 3


def _load_all() -> list[dict]:
    return [json.loads(p.read_text()) for p in SOURCE.glob("*.json")]


def export(models: list[str]) -> None:
    (OUT / "evidence").mkdir(parents=True, exist_ok=True)
    records = _load_all()
    by_id = {r["id"]: r for r in records}
    groups: dict[tuple[str, str, str], list[dict]] = defaultdict(list)
    for r in records:
        if r["kind"] == "probe" and r["model"] in models:
            groups[(r["model"], r["capability"], r["path"])].append(r)
    for (model, capability, path), items in sorted(groups.items()):
        latest = sorted(items, key=lambda r: (r["created_at"], r["trial"]))[-TRIALS:]
        trials = []
        for r in latest:
            response = r["response"]
            observed = (
                response.get("error")
                or response.get("text")
                or str(response.get("tool_calls") or response.get("parsed"))
            )
            trials.append(
                {
                    "passed": r["passed"],
                    "observed": observed[:300],
                    "evidence_id": r["id"],
                    "error": response.get("error"),
                }
            )
            _copy(r["id"])
            image_id = r.get("request", {}).get("image_evidence_id")
            if image_id and image_id in by_id:
                _copy(image_id)
        votes = [t["passed"] for t in trials]
        passes, fails, errors = votes.count(True), votes.count(False), votes.count(None)
        result = {
            "capability": capability,
            "model": model,
            "path": path,
            "outcome": majority(passes, fails, errors),
            "passes": passes,
            "fails": fails,
            "errors": errors,
            "trials": trials,
        }
        name = f"{model}__{capability}__{path}.json"
        (OUT / name).write_text(json.dumps(result, indent=2))
        print(name, result["outcome"], f"{passes}/{fails}/{errors}")
    for model in models:
        meta = sorted(
            (r for r in records if r["kind"] == "metadata" and r["model"] == model),
            key=lambda r: r["created_at"],
        )
        if meta:
            last = meta[-1]
            fields = {k: last["response"][k] for k in ("max_input_tokens", "max_output_tokens")}
            (OUT / f"{model}__limits__provider.json").write_text(
                json.dumps({**fields, "evidence_id": last["id"]}, indent=2)
            )
            _copy(last["id"])
            print(f"{model}__limits__provider.json")


def _copy(evidence_id: str) -> None:
    shutil.copy(SOURCE / f"{evidence_id}.json", OUT / "evidence" / f"{evidence_id}.json")


def snapshot_models_dev(provider: str = "google") -> None:
    """Keep only one provider from the cached catalog, to keep the fixture small."""
    catalog = json.loads((settings.data_dir / "models_dev_api.json").read_text(encoding="utf-8"))
    path = ROOT / "evals" / "fixtures" / "models_dev_api.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({provider: catalog[provider]}, indent=1), encoding="utf-8")
    print(path.name)


if __name__ == "__main__":
    export(sys.argv[1:])
    snapshot_models_dev()

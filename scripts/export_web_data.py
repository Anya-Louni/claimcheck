"""Copy recorded runs and their evidence into the web app, for recorded demo mode.

Everything copied comes from real runs: the event log from `claimcheck.cli --record`,
the evidence files those events cite, the audio clips the probes played, and the
eval results table.

Usage:
    uv run python scripts/export_web_data.py
"""

import json
import re
import shutil
from pathlib import Path

from claimcheck.config import ROOT, settings
from claimcheck.probes import tasks

WEB = ROOT / "web"
PUBLIC = WEB / "public"
DATA = WEB / "src" / "data"
EVIDENCE = settings.data_dir / "evidence"
IDS = re.compile(r"\b(?:probe|metadata|image|source)-[0-9a-f]{10}\b")


def export_demo(path: Path) -> None:
    text = path.read_text(encoding="utf-8")
    (PUBLIC / "demo").mkdir(parents=True, exist_ok=True)
    shutil.copy(path, PUBLIC / "demo" / path.name)
    ids = set(IDS.findall(text))
    out = PUBLIC / "demo" / "evidence"
    shutil.rmtree(out, ignore_errors=True)  # evidence from older recordings must not linger
    out.mkdir()
    for evidence_id in sorted(ids):
        source = EVIDENCE / f"{evidence_id}.json"
        record = json.loads(source.read_text())
        image_id = record.get("request", {}).get("image_evidence_id")
        if image_id:
            shutil.copy(EVIDENCE / f"{image_id}.json", out / f"{image_id}.json")
        shutil.copy(source, out / source.name)
    events = [json.loads(line) for line in text.splitlines() if line.strip()]
    report = [e for e in events if e["type"] == "result"][-1]["report"]
    DATA.mkdir(parents=True, exist_ok=True)
    (DATA / f"{path.stem}-report.json").write_text(json.dumps(report, indent=2))
    print(path.name, len(events), "events,", len(ids), "evidence files")


def export_audio() -> None:
    out = PUBLIC / "demo" / "audio"
    out.mkdir(parents=True, exist_ok=True)
    for clip in tasks.AUDIO_DIR.glob("digits_*.wav"):
        shutil.copy(clip, out / clip.name)


def export_sample_image() -> None:
    out = PUBLIC / "probes"
    out.mkdir(parents=True, exist_ok=True)
    case = tasks.make_image_case(0)
    (out / "image-probe-0.png").write_bytes(case.png)
    (DATA / "image-probe-0.json").write_text(
        json.dumps({"word": case.word, "number": case.number, "color": case.color})
    )


def export_evals() -> None:
    """Parse the results table in evals/RESULTS.md into JSON for the landing page."""
    text = (ROOT / "evals" / "RESULTS.md").read_text(encoding="utf-8")
    rows = []
    for line in text.splitlines():
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) == 7 and cells[2] in ("pass", "FAIL"):
            rows.append(
                {
                    "case": cells[0],
                    "kind": cells[1],
                    "passed": cells[2] == "pass",
                    "failed_checks": cells[3],
                    "model_calls": int(cells[4]),
                    "corrections": int(cells[5]),
                }
            )
    date = re.search(r"Run on (\d{4}-\d{2}-\d{2})", text)
    payload = {"date": date.group(1) if date else None, "rows": rows}
    (DATA / "evals.json").write_text(json.dumps(payload, indent=2))
    print("evals:", sum(r["passed"] for r in rows), "/", len(rows))


if __name__ == "__main__":
    for demo in sorted((ROOT / "demo").glob("*.jsonl")):
        export_demo(demo)
    export_audio()
    export_sample_image()
    export_evals()

"""Store probe transcripts and fetched sources as evidence records on disk."""

import json
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from claimcheck.config import settings

EVIDENCE_DIR = settings.data_dir / "evidence"


def save(kind: str, payload: dict[str, Any], directory: Path | None = None) -> str:
    """Write one evidence record and return its id."""
    folder = directory or EVIDENCE_DIR
    folder.mkdir(parents=True, exist_ok=True)
    evidence_id = f"{kind}-{uuid.uuid4().hex[:10]}"
    record = {
        "id": evidence_id,
        "kind": kind,
        "created_at": datetime.now(UTC).isoformat(timespec="seconds"),
        **payload,
    }
    (folder / f"{evidence_id}.json").write_text(json.dumps(record, indent=2, default=str))
    return evidence_id


def load(evidence_id: str, directory: Path | None = None) -> dict[str, Any] | None:
    """Return one evidence record, or None if the id is unknown or malformed."""
    if not evidence_id.replace("-", "").replace("_", "").isalnum():
        return None
    path = (directory or EVIDENCE_DIR) / f"{evidence_id}.json"
    if not path.exists():
        return None
    return json.loads(path.read_text())

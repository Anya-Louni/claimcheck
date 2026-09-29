"""FastAPI app: streams agent runs as Server-Sent Events.

Keys stay on the server. The browser only ever sees events, reports and evidence.
"""

import json
import time
from collections import defaultdict, deque
from collections.abc import Iterator
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from langgraph.types import Command
from pydantic import BaseModel

from claimcheck import evidence, persistence
from claimcheck.agent import build_agent
from claimcheck.config import ROOT, settings
from claimcheck.media import MediaError, audio_block, check_audio, clean_image, image_block
from claimcheck.probes import daily_cap
from claimcheck.streaming import STREAM_MODES, to_events

DEMO_DIR = ROOT / "demo"
RUNS_PER_HOUR = 10
MAX_IMAGES = 3

app = FastAPI(title="Claimcheck")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.cors_origin],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)

_agent = build_agent(checkpointer=persistence.checkpointer(), store=persistence.store())
_hits: dict[str, deque[float]] = defaultdict(deque)


def _rate_limit(request: Request) -> None:
    """Allow RUNS_PER_HOUR agent runs per client IP."""
    ip = request.client.host if request.client else "unknown"
    window = _hits[ip]
    now = time.time()
    while window and now - window[0] > 3600:
        window.popleft()
    if len(window) >= RUNS_PER_HOUR:
        raise HTTPException(429, "Too many runs from this address. Try again later.")
    window.append(now)


def _config(thread_id: str) -> dict[str, Any]:
    return {
        "configurable": {"thread_id": thread_id},
        "tags": ["claimcheck"],
        "metadata": {"agent": "claimcheck", "thread_id": thread_id},
    }


def _sse(events: Iterator[dict[str, Any]]) -> StreamingResponse:
    def body() -> Iterator[str]:
        for event in events:
            yield f"event: {event['type']}\ndata: {json.dumps(event, default=str)}\n\n"

    return StreamingResponse(body(), media_type="text/event-stream")


def _check_thread(thread_id: str) -> None:
    if not (0 < len(thread_id) <= 64) or not thread_id.replace("-", "").isalnum():
        raise HTTPException(400, "thread_id must be 1 to 64 letters, digits or dashes")


@app.get("/health")
def health() -> dict[str, Any]:
    return {"ok": True, "model": settings.model}


@app.get("/limits")
def limits() -> dict[str, Any]:
    caps = settings.limits
    return {
        "daily_calls_used": daily_cap.used(),
        "daily_calls_limit": daily_cap.limit,
        "model_calls_per_run": caps.model_calls_per_run,
        "tool_calls_per_run": caps.tool_calls_per_run,
        "tokens_per_run": caps.tokens_per_run,
        "seconds_per_run": caps.seconds_per_run,
    }


@app.post("/runs")
async def start_run(
    request: Request,
    thread_id: str = Form(...),
    message: str = Form(""),
    images: list[UploadFile] = File(default=[]),
    audio: UploadFile | None = File(default=None),
) -> StreamingResponse:
    """Start or continue a thread. Accepts text, up to 3 images, and one audio clip."""
    _check_thread(thread_id)
    if len(images) > MAX_IMAGES:
        raise HTTPException(400, f"at most {MAX_IMAGES} images")
    content: list[dict[str, Any]] = []
    if message.strip():
        content.append({"type": "text", "text": message.strip()[:4000]})
    try:
        for upload in images:
            content.append(image_block(clean_image(await upload.read(), upload.content_type or "")))
        if audio is not None:
            data = await audio.read()
            check_audio(data, audio.content_type or "")
            content.append(audio_block(data, audio.content_type or ""))
    except MediaError as exc:
        raise HTTPException(400, str(exc)) from exc
    if not content:
        raise HTTPException(400, "send a message, an image or audio")
    _rate_limit(request)
    payload = {"messages": [{"role": "user", "content": content}]}
    stream = _agent.stream(payload, _config(thread_id), stream_mode=STREAM_MODES)
    return _sse(to_events(stream))


class Decision(BaseModel):
    type: str
    message: str | None = None
    edited_action: dict[str, Any] | None = None


class Resume(BaseModel):
    decisions: list[Decision]


@app.post("/runs/{thread_id}/resume")
def resume_run(thread_id: str, body: Resume) -> StreamingResponse:
    """Answer a pending approval with approve, edit or reject decisions."""
    _check_thread(thread_id)
    if not _agent.get_state(_config(thread_id)).interrupts:
        raise HTTPException(409, "nothing is waiting for approval on this thread")
    decisions = [d.model_dump(exclude_none=True) for d in body.decisions]
    command: Command = Command(resume={"decisions": decisions})
    return _sse(to_events(_agent.stream(command, _config(thread_id), stream_mode=STREAM_MODES)))


@app.get("/evidence/{evidence_id}")
def get_evidence(evidence_id: str) -> dict[str, Any]:
    record = evidence.load(evidence_id)
    if record is None:
        raise HTTPException(404, "unknown evidence id")
    return record


@app.get("/findings/{provider}/{model}")
def get_findings(provider: str, model: str) -> list[dict[str, Any]]:
    items = persistence.store().search(("findings", provider, model), limit=20)
    return [{"saved_at": i.key, **i.value} for i in sorted(items, key=lambda i: i.key)]


@app.get("/demo/{name}")
def replay_demo(name: str) -> StreamingResponse:
    """Replay a recorded real run, labeled as recorded, for when the live API is unavailable."""
    path = DEMO_DIR / f"{name}.jsonl"
    if not name.replace("-", "").isalnum() or not path.exists():
        raise HTTPException(404, "unknown demo")
    return _sse(_replay(path))


def _replay(path: Path) -> Iterator[dict[str, Any]]:
    yield {"type": "trace", "kind": "recorded", "detail": f"Recorded example: {path.stem}"}
    for line in path.read_text(encoding="utf-8").splitlines():
        time.sleep(0.15)
        yield json.loads(line)

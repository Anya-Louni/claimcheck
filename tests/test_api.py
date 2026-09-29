import io
import json
from typing import Any

import pytest
from conftest import fake_model, tool_call
from fastapi.testclient import TestClient
from langchain_core.messages import AIMessage
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.store.memory import InMemoryStore
from PIL import Image

from claimcheck.agent import build_agent
from claimcheck.api import app as app_module
from claimcheck.tools import save_finding

client = TestClient(app_module.app)


def _events(text: str) -> list[dict[str, Any]]:
    return [json.loads(line[6:]) for line in text.splitlines() if line.startswith("data: ")]


def _png() -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (10, 10), "blue").save(out, format="PNG")
    return out.getvalue()


@pytest.fixture
def fake_agent(monkeypatch: pytest.MonkeyPatch) -> None:
    args = {
        "provider": "g",
        "model": "m",
        "integration_version": "v",
        "verdicts": [{"field": "tool_calling", "verdict": "confirmed"}],
    }
    agent = build_agent(
        model=fake_model(tool_call("save_finding", args), AIMessage("done")),
        checkpointer=InMemorySaver(),
        store=InMemoryStore(),
        tools=[save_finding],
    )
    monkeypatch.setattr(app_module, "_agent", agent)
    app_module._hits.clear()


def test_health_and_limits() -> None:
    assert client.get("/health").json()["ok"] is True
    limits = client.get("/limits").json()
    assert limits["daily_calls_limit"] > 0 and "tokens_per_run" in limits


def test_rejects_bad_input() -> None:
    assert client.post("/runs", data={"thread_id": "bad id!", "message": "x"}).status_code == 400
    assert client.post("/runs", data={"thread_id": "t1", "message": " "}).status_code == 400
    gif = {"images": ("a.gif", b"GIF89a", "image/gif")}
    assert client.post("/runs", data={"thread_id": "t1"}, files=gif).status_code == 400
    assert client.get("/evidence/nope").status_code == 404
    assert client.get("/demo/..%2Fsecrets").status_code == 404


def test_run_streams_interrupt_then_resume(fake_agent: None) -> None:
    files = {"images": ("shot.png", _png(), "image/png")}
    response = client.post("/runs", data={"thread_id": "api1", "message": "check"}, files=files)
    events = _events(response.text)
    assert any(e["type"] == "interrupt" for e in events)
    tool_calls = [e for e in events if e.get("kind") == "tool_call"]
    assert tool_calls[0]["name"] == "save_finding"

    resumed = client.post("/runs/api1/resume", json={"decisions": [{"type": "approve"}]})
    names = [e.get("name") for e in _events(resumed.text) if e.get("kind") == "tool_result"]
    assert names == ["save_finding"]
    assert client.post("/runs/api1/resume", json={"decisions": []}).status_code == 409


def test_rate_limit_per_ip(fake_agent: None, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(app_module, "RUNS_PER_HOUR", 1)
    first = client.post("/runs", data={"thread_id": "rl1", "message": "a"})
    assert first.status_code == 200
    second = client.post("/runs", data={"thread_id": "rl2", "message": "b"})
    assert second.status_code == 429


def test_audio_fixture_served_and_paths_guarded() -> None:
    ok = client.get("/fixtures/audio/digits_39147.wav")
    assert ok.status_code == 200 and ok.headers["content-type"] == "audio/wav"
    assert client.get("/fixtures/audio/..%2F..%2F.env").status_code == 404
    assert client.get("/fixtures/audio/other.wav").status_code == 404


def test_client_ip_uses_proxy_header_only_when_trusted(monkeypatch: pytest.MonkeyPatch) -> None:
    from starlette.requests import Request

    scope = {
        "type": "http",
        "headers": [(b"x-forwarded-for", b"1.1.1.1, 2.2.2.2")],
        "client": ("10.0.0.1", 1234),
    }
    request = Request(scope)
    assert app_module.client_ip(request) == "10.0.0.1"
    monkeypatch.setenv("TRUST_PROXY", "1")
    assert app_module.client_ip(request) == "2.2.2.2"


def test_client_ip_from_signed_proxy_header(monkeypatch: pytest.MonkeyPatch) -> None:
    from starlette.requests import Request

    def request(secret: bytes) -> Request:
        headers = [(b"x-client-ip", b"9.9.9.9"), (b"x-proxy-secret", secret)]
        return Request({"type": "http", "headers": headers, "client": ("10.0.0.1", 1)})

    monkeypatch.setenv("PROXY_SECRET", "s3cret")
    assert app_module.client_ip(request(b"s3cret")) == "9.9.9.9"
    assert app_module.client_ip(request(b"wrong")) == "10.0.0.1"

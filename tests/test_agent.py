"""Agent-level tests with a fake chat model. No API calls, no cost."""

import json
from typing import Any

import pytest
from conftest import fake_model, tool_call
from langchain_core.messages import AIMessage
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.store.memory import InMemoryStore
from langgraph.types import Command

from claimcheck import claims, evidence
from claimcheck.agent import build_agent
from claimcheck.config import Limits
from claimcheck.schemas import ProfileReport
from claimcheck.streaming import STREAM_MODES, to_events
from claimcheck.tools import get_claims, list_findings, save_finding

CLAIMS = {"provider": "google_genai", "model": "m", "integration": "pkg==1", "claims": []}


def report_args(evidence_ids: list[str], verdict: str = "confirmed") -> dict[str, Any]:
    return {
        "provider": "google_genai",
        "model": "m",
        "integration_version": "pkg==1",
        "scope_note": "Google only.",
        "claims": [
            {
                "field": "tool_calling",
                "claimed_langchain": "true",
                "claimed_models_dev": "true",
                "observed": "3/3 pass",
                "verdict": verdict,
                "layer": "none",
                "evidence_ids": evidence_ids,
                "note": "Works.",
            }
        ],
        "draft_change_id": None,
        "unverified": [],
        "summary": "Tool calling works.",
    }


def _passing_probe() -> str:
    record = {"model": "m", "capability": "tool_calling", "path": "langchain", "passed": True}
    return evidence.save("probe", record)


@pytest.fixture(autouse=True)
def fixed_claims(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(claims, "get_claims_data", lambda provider, model: CLAIMS)


def _agent(
    *messages: AIMessage,
    store: InMemoryStore | None = None,
    tools: Any = None,
    limits: Limits | None = None,
) -> Any:
    return build_agent(
        limits=limits,
        model=fake_model(*messages),
        checkpointer=InMemorySaver(),
        store=store or InMemoryStore(),
        tools=tools or [get_claims, list_findings, save_finding],
    )


def _config(thread: str) -> dict[str, Any]:
    return {"configurable": {"thread_id": thread}}


def _ask(text: str) -> dict[str, Any]:
    return {"messages": [{"role": "user", "content": text}]}


def test_agent_calls_tool_and_returns_report() -> None:
    probe_id = _passing_probe()
    agent = _agent(
        tool_call("get_claims", {"provider": "google", "model": "m"}),
        tool_call("ProfileReport", report_args([probe_id]), "call_2"),
    )
    result = agent.invoke(_ask("check m"), _config("a"))
    report = result["structured_response"]
    assert isinstance(report, ProfileReport)
    assert report.claims[0].verdict == "confirmed"
    tool_msgs = [m for m in result["messages"] if m.type == "tool" and m.name == "get_claims"]
    assert json.loads(tool_msgs[0].content)["integration"] == "pkg==1"


def test_evidence_check_downgrades_invented_ids() -> None:
    agent = _agent(tool_call("ProfileReport", report_args(["probe-madeup"])))
    report = agent.invoke(_ask("check m"), _config("b"))["structured_response"]
    assert report.claims[0].verdict == "inconclusive"
    assert report.claims[0].evidence_ids == []
    assert any("recomputed as 'inconclusive'" in item for item in report.unverified)


def test_evidence_for_another_model_does_not_count() -> None:
    other = evidence.save("probe", {"model": "other-model"})
    agent = _agent(tool_call("ProfileReport", report_args([other])))
    report = agent.invoke(_ask("x"), _config("c"))["structured_response"]
    assert report.claims[0].verdict == "inconclusive"


def test_save_finding_waits_for_approval_then_saves() -> None:
    store = InMemoryStore()
    args = {
        "provider": "google_genai",
        "model": "m",
        "integration_version": "pkg==1",
        "verdicts": [{"field": "tool_calling", "verdict": "confirmed"}],
    }
    agent = _agent(tool_call("save_finding", args), AIMessage("saved"), store=store)
    first = agent.invoke(_ask("save"), _config("hitl"))
    assert first["__interrupt__"], "save_finding must pause for approval"
    assert store.search(("findings", "google_genai", "m")) == []
    agent.invoke(Command(resume={"decisions": [{"type": "approve"}]}), _config("hitl"))
    saved = store.search(("findings", "google_genai", "m"))
    assert saved[0].value["verdicts"] == {"tool_calling": "confirmed"}


def test_rejected_save_writes_nothing() -> None:
    store = InMemoryStore()
    args = {
        "provider": "g",
        "model": "m",
        "integration_version": "v",
        "verdicts": [{"field": "x", "verdict": "unclaimed"}],
    }
    agent = _agent(tool_call("save_finding", args), AIMessage("not saved"), store=store)
    agent.invoke(_ask("save"), _config("rej"))
    decision = {"decisions": [{"type": "reject", "message": "no"}]}
    agent.invoke(Command(resume=decision), _config("rej"))
    assert store.search(("findings", "g", "m")) == []


def test_memory_keeps_earlier_turns_per_thread() -> None:
    agent = _agent(AIMessage("first"), AIMessage("second"))
    agent.invoke(_ask("hello"), _config("mem"))
    state = agent.invoke(_ask("again"), _config("mem"))
    humans = [m.content for m in state["messages"] if m.type == "human"]
    assert humans == ["hello", "again"]


def test_model_call_limit_stops_cleanly() -> None:
    loop = [
        tool_call("get_claims", {"provider": "google", "model": "m"}, f"c{i}") for i in range(5)
    ]
    agent = _agent(*loop, limits=Limits(model_calls_per_run=2))
    result = agent.invoke(_ask("x"), _config("lim"))
    last = result["messages"][-1]
    assert isinstance(last, AIMessage) and "limit" in last.text.lower()


def test_stream_events_are_typed() -> None:
    probe_id = _passing_probe()
    agent = _agent(
        tool_call("get_claims", {"provider": "google", "model": "m"}),
        tool_call("ProfileReport", report_args([probe_id]), "call_2"),
    )
    stream = agent.stream(_ask("check"), _config("s"), stream_mode=STREAM_MODES)
    events = list(to_events(stream))
    kinds = {(e["type"], e.get("kind")) for e in events}
    assert ("trace", "tool_call") in kinds
    assert ("trace", "tool_result") in kinds
    assert ("trace", "budget") in kinds
    results = [e for e in events if e["type"] == "result"]
    assert results[-1]["report"]["claims"][0]["verdict"] == "confirmed"
    assert all(e["type"] in {"trace", "token", "interrupt", "result", "error"} for e in events)


def test_model_ids_with_dots_can_be_saved() -> None:
    from claimcheck.persistence import findings_namespace

    store = InMemoryStore()
    args = {
        "provider": "google_genai",
        "model": "gemini-3.5-flash-lite",
        "integration_version": "pkg==1",
        "verdicts": [{"field": "tool_calling", "verdict": "confirmed"}],
    }
    agent = _agent(tool_call("save_finding", args), AIMessage("saved"), store=store)
    agent.invoke(_ask("save"), _config("dots"))
    agent.invoke(Command(resume={"decisions": [{"type": "approve"}]}), _config("dots"))
    saved = store.search(findings_namespace("google_genai", "gemini-3.5-flash-lite"))
    assert saved[0].value["verdicts"] == {"tool_calling": "confirmed"}

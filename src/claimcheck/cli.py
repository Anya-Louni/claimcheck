"""Run one investigation from the terminal and print the trace and the report.

Usage:
    uv run python -m claimcheck.cli "Check google gemini-3.5-flash-lite" --thread t1
    uv run python -m claimcheck.cli --thread t1 --resume approve
"""

import argparse
import json
import time
from typing import Any

from langgraph.types import Command

from claimcheck import persistence
from claimcheck.agent import build_agent
from claimcheck.streaming import STREAM_MODES, to_events


def _print(event: dict[str, Any]) -> None:
    kind = event.get("kind", "")
    if event["type"] == "token":
        return
    if event["type"] == "trace" and kind == "tool_call":
        print(f"-> {event['name']}({json.dumps(event['args'])})")
    elif event["type"] == "trace" and kind == "tool_result":
        print(f"<- {event['name']} [{event['status']}] {event['detail'][:200]}")
    elif event["type"] == "trace" and kind == "budget":
        print(f"   budget: {event['tokens']} tokens, {event['daily_calls']} calls today")
    elif event["type"] == "trace" and kind == "model":
        print(f"   model: {event['detail']}")
    elif event["type"] == "interrupt":
        print("APPROVAL NEEDED:", json.dumps(event["value"], indent=2)[:1500])
    elif event["type"] == "result":
        print("REPORT:\n" + json.dumps(event["report"], indent=2))
    elif event["type"] == "error":
        print("ERROR:", event["message"])


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("message", nargs="?")
    parser.add_argument("--thread", required=True)
    parser.add_argument("--resume", choices=["approve", "reject"])
    parser.add_argument("--record", help="append events to this JSONL file for demo replay")
    args = parser.parse_args()

    agent = build_agent(checkpointer=persistence.checkpointer(), store=persistence.store())
    config = {"configurable": {"thread_id": args.thread}, "tags": ["claimcheck", args.thread]}
    if args.resume:
        pending = agent.get_state(config).interrupts
        count = len(pending[0].value["action_requests"]) if pending else 1
        payload: Any = Command(resume={"decisions": [{"type": args.resume}] * count})
    else:
        payload = {"messages": [{"role": "user", "content": args.message}]}
    if args.resume and args.record:
        _record(args.record, {"type": "decision", "decision": args.resume})
    started = time.monotonic()
    for event in to_events(agent.stream(payload, config, stream_mode=STREAM_MODES)):
        _print(event)
        if args.record and event["type"] != "token":
            event["at_ms"] = int((time.monotonic() - started) * 1000)
            _record(args.record, event)


def _record(path: str, event: dict[str, Any]) -> None:
    with open(path, "a", encoding="utf-8") as out:
        out.write(json.dumps(event, default=str) + "\n")


if __name__ == "__main__":
    main()

"""Run the Claimcheck eval set and write evals/RESULTS.md.

The agent model is called live. Probe results, provider limits, search results
and the models.dev catalog are replayed from recordings of real runs, so the
same case always sees the same evidence. With LANGSMITH_API_KEY set, the cases
also run as a LangSmith experiment on a synced dataset.

Usage:
    uv run python evals/run.py              # all cases
    uv run python evals/run.py --case clean-gemma
"""

import argparse
import base64
import json
import os
import shutil
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

EVALS = Path(__file__).resolve().parent
DATA = Path(tempfile.mkdtemp(prefix="claimcheck-eval-"))
os.environ["DATA_DIR"] = str(DATA)
os.environ["CLAIMCHECK_REPLAY_DIR"] = str(EVALS / "recordings")
os.environ["CLAIMCHECK_MODELS_DEV_SNAPSHOT"] = str(EVALS / "fixtures" / "models_dev_api.json")
shutil.copytree(EVALS / "recordings" / "evidence", DATA / "evidence")

from langgraph.checkpoint.memory import InMemorySaver  # noqa: E402
from langgraph.store.memory import InMemoryStore  # noqa: E402
from langgraph.types import Command  # noqa: E402

from claimcheck.agent import build_agent  # noqa: E402
from claimcheck.config import settings  # noqa: E402
from claimcheck.streaming import STREAM_MODES, to_events  # noqa: E402

MIME = {".png": "image/png", ".wav": "audio/wav"}


def load_cases(only: str | None) -> list[dict[str, Any]]:
    lines = (EVALS / "dataset.jsonl").read_text(encoding="utf-8").splitlines()
    cases = [json.loads(line) for line in lines if line.strip()]
    return [c for c in cases if only is None or c["id"] == only]


def _content(case: dict[str, Any], text: str, first: bool) -> list[dict[str, Any]]:
    content: list[dict[str, Any]] = []
    if text:
        content.append({"type": "text", "text": text})
    for key, block in (("image", "image"), ("audio", "audio")):
        if first and case.get(key):
            path = EVALS / "inputs" / case[key]
            data = base64.b64encode(path.read_bytes()).decode()
            content.append({"type": block, "base64": data, "mime_type": MIME[path.suffix]})
    return content


def run_case(case: dict[str, Any]) -> dict[str, Any]:
    """Run every turn of a case, approving any pending action, and collect the trace."""
    fixture = case.get("search_fixture", "search_empty.json")
    os.environ["CLAIMCHECK_SEARCH_FIXTURE"] = str(EVALS / "fixtures" / fixture)
    agent = build_agent(checkpointer=InMemorySaver(), store=InMemoryStore())
    config = {"configurable": {"thread_id": case["id"]}, "tags": ["claimcheck-eval", case["id"]]}
    turns: list[list[dict[str, Any]]] = []
    report, errors, corrections, model_calls = None, [], [], 0
    started = time.monotonic()
    for index, text in enumerate(case["turns"]):
        calls: list[dict[str, Any]] = []
        payload: Any = {"messages": [{"role": "user", "content": _content(case, text, index == 0)}]}
        for _ in range(4):  # the first pass plus up to three approvals
            interrupted = False
            for event in to_events(agent.stream(payload, config, stream_mode=STREAM_MODES)):
                kind = event.get("kind")
                if kind == "tool_call":
                    calls.append({"name": event["name"], "args": event["args"]})
                elif kind == "budget":
                    model_calls += 1
                elif kind == "evidence_check":
                    corrections.extend(event["problems"])
                elif event["type"] == "result":
                    report = event["report"]
                elif event["type"] == "error":
                    errors.append(event["message"])
                elif event["type"] == "interrupt":
                    interrupted = True
                    count = len(event["value"]["action_requests"])
                    payload = Command(resume={"decisions": [{"type": "approve"}] * count})
            if not interrupted:
                break
        turns.append(calls)
    return {
        "turns": turns,
        "report": report,
        "errors": errors,
        "corrections": corrections,
        "model_calls": model_calls,
        "seconds": round(time.monotonic() - started, 1),
    }


def evaluate(case: dict[str, Any], run: dict[str, Any]) -> dict[str, bool]:
    """Deterministic checks. Each returns True when the agent behaved as expected."""
    expect = case["expect"]
    names = [c["name"] for turn in run["turns"] for c in turn]
    last = [c["name"] for c in run["turns"][-1]] if run["turns"] else []
    report = run["report"] or {}
    verdicts = {c["field"]: c for c in report.get("claims", [])}
    checks: dict[str, bool] = {"no_errors": not run["errors"], "schema_valid": bool(report)}
    if "tools_include" in expect:
        checks["tools_include"] = all(t in names for t in expect["tools_include"])
    if "tools_exclude" in expect:
        checks["tools_exclude"] = not any(t in names for t in expect["tools_exclude"])
    if "tools_include_prefix" in expect:
        checks["tools_include_prefix"] = all(
            any(n.startswith(p) for n in names) for p in expect["tools_include_prefix"]
        )
    if "tools_exclude_prefix" in expect:
        checks["tools_exclude_prefix"] = not any(
            n.startswith(p) for n in names for p in expect["tools_exclude_prefix"]
        )
        checks.pop("schema_valid")  # a plain refusal without a report is acceptable here
    if "last_turn_tools_include" in expect:
        checks["last_turn_tools"] = all(t in last for t in expect["last_turn_tools_include"])
    if "last_turn_model" in expect:
        models = [c["args"].get("model") for c in run["turns"][-1] if "model" in c["args"]]
        checks["remembers_model"] = bool(models) and all(
            m == expect["last_turn_model"] for m in models
        )
    if "claims_model" in expect:
        asked = [
            c["args"].get("model") for t in run["turns"] for c in t if c["name"] == "get_claims"
        ]
        checks["reads_right_model"] = expect["claims_model"] in asked
    for field, allowed in expect.get("verdicts", {}).items():
        checks[f"verdict:{field}"] = verdicts.get(field, {}).get("verdict") in allowed
    if "any_layer" in expect:
        checks["layer"] = any(c.get("layer") == expect["any_layer"] for c in verdicts.values())
    if expect.get("no_unsupported_confirmed"):
        checks["no_unsupported_confirmed"] = all(
            c["evidence_ids"] for c in verdicts.values() if c["verdict"] == "confirmed"
        )
    return checks


def write_results(rows: list[dict[str, Any]]) -> str:
    passed = sum(r["pass"] for r in rows)
    lines = [
        "# Eval results",
        "",
        f"Run on {time.strftime('%Y-%m-%d')} with agent model `{settings.model}` (live calls).",
        "Probe results, provider limits, search results and the models.dev catalog were",
        "replayed from recordings of real runs in `evals/recordings/` and `evals/fixtures/`.",
        "The injection fixtures are synthetic test pages and screenshots, labeled as such.",
        "",
        f"**{passed}/{len(rows)} cases passed.**",
        "",
        "| Case | Kind | Result | Failed checks | Model calls | Report corrections | Seconds |",
        "|---|---|---|---|---|---|---|",
    ]
    for r in rows:
        failed = ", ".join(k for k, v in r["checks"].items() if not v) or "-"
        lines.append(
            f"| {r['id']} | {r['kind']} | {'pass' if r['pass'] else 'FAIL'} | {failed} | "
            f"{r['model_calls']} | {len(r['corrections'])} | {r['seconds']} |"
        )
    lines += ["", "## Failures and corrections", ""]
    for r in rows:
        if not r["pass"] or r["corrections"] or r["errors"]:
            lines.append(f"### {r['id']}")
            lines += [f"- error: {e[:300]}" for e in r["errors"]]
            lines += [f"- evidence check: {c}" for c in r["corrections"]]
            lines.append(f"- tools called: {', '.join(r['tools']) or 'none'}")
            lines.append("")
    text = "\n".join(lines) + "\n"
    (EVALS / "RESULTS.md").write_text(text, encoding="utf-8")
    return text


def _row(case: dict[str, Any], run: dict[str, Any]) -> dict[str, Any]:
    checks = evaluate(case, run)
    row = {
        "id": case["id"],
        "kind": case["kind"],
        "pass": all(checks.values()),
        "checks": checks,
        "tools": [c["name"] for t in run["turns"] for c in t],
        **{k: run[k] for k in ("errors", "corrections", "model_calls", "seconds")},
    }
    print(f"{case['id']}: {'pass' if row['pass'] else 'FAIL'} {checks}", flush=True)
    return row


def run_local(cases: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [_row(case, run_case(case)) for case in cases]


def run_langsmith(cases: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Sync the cases to a LangSmith dataset and run them as an experiment."""
    from langsmith import Client
    from langsmith import evaluate as ls_evaluate

    client = Client()
    name = "claimcheck-evals"
    if not client.has_dataset(dataset_name=name):
        dataset = client.create_dataset(name)
        client.create_examples(
            dataset_id=dataset.id,
            inputs=[{"case": c} for c in cases],
            outputs=[{"expect": c["expect"]} for c in cases],
        )

    rows: list[dict[str, Any]] = []
    wanted = {c["id"] for c in cases}

    def target(inputs: dict[str, Any]) -> dict[str, Any]:
        run = run_case(inputs["case"])
        rows.append(_row(inputs["case"], run))
        return run

    def checks(run: Any, example: Any) -> list[dict[str, Any]]:
        result = evaluate(example.inputs["case"], run.outputs)
        return [{"key": k, "score": int(v)} for k, v in result.items()]

    examples = [
        e for e in client.list_examples(dataset_name=name) if e.inputs["case"]["id"] in wanted
    ]
    ls_evaluate(
        target,
        data=examples,
        evaluators=[checks],
        experiment_prefix="claimcheck",
        max_concurrency=1,
    )
    return rows


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--case")
    args = parser.parse_args()
    cases = load_cases(args.case)
    if not cases:
        sys.exit("no matching case")
    rows = run_langsmith(cases) if os.getenv("LANGSMITH_API_KEY") else run_local(cases)
    print(write_results(rows))


if __name__ == "__main__":
    main()

"""Run a capability probe against a target model on a chosen call path."""

import base64
import hashlib
import json
import os
from functools import cache, partial
from pathlib import Path
from typing import Any

from langchain_core.rate_limiters import InMemoryRateLimiter

from claimcheck import evidence
from claimcheck.budget import DailyCap
from claimcheck.claims import resolve_provider
from claimcheck.config import settings
from claimcheck.probes import paths, tasks
from claimcheck.probes.base import Path_, ProbeCase, ProbeResult, Trial, run_trials

CAPABILITIES = (
    "tool_calling",
    "tool_choice",
    "parallel_tool_calls",
    "structured_output",
    "image_inputs",
    "audio_inputs",
)

# One shared limiter keeps probes under free-tier request rates.
_limiter = InMemoryRateLimiter(
    requests_per_second=0.2, check_every_n_seconds=0.1, max_bucket_size=1
)

daily_cap = DailyCap(settings.data_dir / "daily_usage.json", settings.limits.provider_calls_per_day)


def _digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()[:16]


def _lc_cases(model_id: str, capability: str, trials: int) -> list[ProbeCase]:
    from claimcheck.models import make_model

    model = make_model(model_id, rate_limiter=_limiter)
    simple = {
        "tool_calling": (
            paths.lc_tool_calling,
            tasks.score_tool_calling,
            tasks.TOOL_CALLING_PROMPT,
        ),
        "tool_choice": (paths.lc_tool_choice, tasks.score_tool_choice, tasks.TOOL_CHOICE_PROMPT),
        "parallel_tool_calls": (paths.lc_parallel, tasks.score_parallel, tasks.PARALLEL_PROMPT),
        "structured_output": (paths.lc_structured, tasks.score_structured, tasks.STRUCTURED_PROMPT),
    }
    if capability in simple:
        call, score, prompt = simple[capability]
        return [ProbeCase({"prompt": prompt}, partial(call, model), score) for _ in range(trials)]
    if capability == "image_inputs":
        cases = [tasks.make_image_case(seed) for seed in range(trials)]
        return [
            ProbeCase(
                _image_request(c),
                partial(paths.lc_image, model, c),
                partial(_swap(tasks.score_image), c),
            )
            for c in cases
        ]
    if capability == "audio_inputs":
        clips = tasks.audio_cases()
        return [
            ProbeCase(
                _audio_request(clips[i % len(clips)]),
                partial(paths.lc_audio, model, clips[i % len(clips)]),
                partial(_swap(tasks.score_audio), clips[i % len(clips)]),
            )
            for i in range(trials)
        ]
    raise ValueError(f"unknown capability {capability}")


@cache
def _genai_client() -> Any:
    """One long-lived SDK client. A temporary client closes before its call ends."""
    from google import genai

    return genai.Client()


def _sdk_cases(model_name: str, capability: str, trials: int) -> list[ProbeCase]:
    client = _genai_client()
    scores = {
        "tool_calling": tasks.score_tool_calling,
        "tool_choice": tasks.score_tool_choice,
        "parallel_tool_calls": tasks.score_parallel,
        "structured_output": tasks.score_structured,
    }
    if capability in scores:
        call = partial(_limited, paths.sdk_call, client, model_name, capability)
        info = {"capability": capability, "path": "google-genai generate_content"}
        return [ProbeCase(info, call, scores[capability]) for _ in range(trials)]
    cases: list[Any]
    score: Any
    request: Any
    if capability == "image_inputs":
        cases = [tasks.make_image_case(seed) for seed in range(trials)]
        score, request = tasks.score_image, _image_request
    elif capability == "audio_inputs":
        clips = tasks.audio_cases()
        cases = [clips[i % len(clips)] for i in range(trials)]
        score, request = tasks.score_audio, _audio_request
    else:
        raise ValueError(f"unknown capability {capability}")
    return [
        ProbeCase(
            request(c),
            partial(_limited, paths.sdk_call, client, model_name, capability, c),
            partial(_swap(score), c),
        )
        for c in cases
    ]


def _limited(fn: Any, *args: Any) -> Any:
    _limiter.acquire()
    return fn(*args)


def _swap(score: Any) -> Any:
    """Turn score(obs, case) into score(case, obs) so partial can bind the case."""
    return lambda case, obs: score(obs, case)


def _image_request(case: tasks.ImageCase) -> dict[str, Any]:
    image_id = evidence.save(
        "image", {"png_base64": base64.b64encode(case.png).decode(), "sha256": _digest(case.png)}
    )
    return {
        "prompt": tasks.IMAGE_PROMPT,
        "image_evidence_id": image_id,
        "expected": {"word": case.word, "number": case.number, "color": case.color},
    }


def _audio_request(case: tasks.AudioCase) -> dict[str, Any]:
    return {
        "prompt": tasks.AUDIO_PROMPT,
        "audio_fixture": f"fixtures/audio/digits_{case.digits}.wav",
        "sha256": _digest(case.wav),
        "expected": case.digits,
    }


def _replay_file(model: str, capability: str, path: str) -> Path | None:
    folder = os.getenv("CLAIMCHECK_REPLAY_DIR")
    if not folder:
        return None
    return Path(folder) / f"{model}__{capability}__{path}.json"


def _load_replay(file: Path) -> ProbeResult:
    data = json.loads(file.read_text())
    data["trials"] = [Trial(**t) for t in data["trials"]]
    data["live"] = False
    return ProbeResult(**data)


def run_probe(
    provider: str, model: str, capability: str, path: Path_ = "langchain", trials: int | None = None
) -> ProbeResult:
    """Run one capability probe N times and return the voted result.

    With CLAIMCHECK_REPLAY_DIR set, a recorded result is returned instead of a
    live call, and marked live=False. With CLAIMCHECK_RECORD_DIR set, live
    results are also written there for later replay.
    """
    if capability not in CAPABILITIES:
        raise ValueError(f"unknown capability {capability}; choose from {CAPABILITIES}")
    resolved = resolve_provider(provider)
    replay = _replay_file(model, capability, path)
    if replay is not None:
        if replay.exists():
            return _load_replay(replay)
        raise FileNotFoundError(f"no recording for {model} {capability} {path}")
    n = trials or settings.trials
    if path == "langchain":
        cases = _lc_cases(f"{resolved.langchain_id}:{model}", capability, n)
    else:
        cases = _sdk_cases(model, capability, n)
    result = run_trials(
        capability=capability, model=model, path=path, cases=cases, daily_cap=daily_cap
    )
    record_dir = os.getenv("CLAIMCHECK_RECORD_DIR")
    if record_dir:
        Path(record_dir).mkdir(parents=True, exist_ok=True)
        out = Path(record_dir) / f"{model}__{capability}__{path}.json"
        out.write_text(json.dumps(result.to_dict(), indent=2))
    return result


def provider_limits(provider: str, model: str) -> dict[str, Any]:
    """Read token limits from the provider's own model metadata endpoint.

    This is how context size is checked: from official metadata, never by
    sending oversized prompts.
    """
    resolve_provider(provider)
    replay = _replay_file(model, "limits", "provider")
    if replay is not None:
        if not replay.exists():
            raise FileNotFoundError(f"no recording of limits for {model}")
        return {**json.loads(replay.read_text()), "live": False}
    daily_cap.charge(1)
    info = _genai_client().models.get(model=model)
    fields = {
        "max_input_tokens": info.input_token_limit,
        "max_output_tokens": info.output_token_limit,
    }
    evidence_id = evidence.save(
        "metadata",
        {
            "model": model,
            "endpoint": f"GET models/{model}",
            "response": {**fields, "name": info.name},
        },
    )
    result = {**fields, "evidence_id": evidence_id}
    record_dir = os.getenv("CLAIMCHECK_RECORD_DIR")
    if record_dir:
        out = Path(record_dir) / f"{model}__limits__provider.json"
        out.write_text(json.dumps(result, indent=2))
    return result

"""Shared probe types, trial runner and majority vote."""

import time
from collections.abc import Callable
from dataclasses import asdict, dataclass, field
from typing import Any, Literal

from claimcheck import evidence
from claimcheck.budget import DailyCap, DailyCapReached

Path_ = Literal["langchain", "provider_sdk"]
Outcome = Literal["pass", "fail", "inconclusive"]


@dataclass
class Observation:
    """What one call returned, in a shape both call paths can fill."""

    text: str = ""
    tool_calls: list[dict[str, Any]] = field(default_factory=list)
    parsed: dict[str, Any] | None = None
    error: str | None = None


@dataclass
class Trial:
    passed: bool | None
    observed: str
    evidence_id: str
    error: str | None = None


@dataclass
class ProbeResult:
    """Outcome of N trials of one capability on one call path."""

    capability: str
    model: str
    path: Path_
    outcome: Outcome
    passes: int
    fails: int
    errors: int
    trials: list[Trial]
    live: bool = True

    def summary(self) -> dict[str, Any]:
        """Compact form for the model: counts, outcome and evidence ids, no transcripts."""
        return {
            "capability": self.capability,
            "model": self.model,
            "path": self.path,
            "outcome": self.outcome,
            "passes": self.passes,
            "fails": self.fails,
            "errors": self.errors,
            "evidence_ids": [t.evidence_id for t in self.trials],
            "sample_observed": self.trials[0].observed if self.trials else "",
            "sample_error": next((t.error for t in self.trials if t.error), None),
            "live": self.live,
        }

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def majority(passes: int, fails: int, errors: int) -> Outcome:
    """Decide the outcome from trial counts.

    Errors do not count as failures: a call that errored says nothing about the
    capability. If errors are at least half the trials, or passes and fails tie,
    the outcome is inconclusive.
    """
    total = passes + fails + errors
    if total == 0 or errors * 2 >= total or passes == fails:
        return "inconclusive"
    return "pass" if passes > fails else "fail"


def is_capability_error(message: str) -> bool:
    """True when the provider rejected the request as unsupported, not as transient."""
    lowered = message.lower()
    transient = ("429", "resource_exhausted", "rate", "quota", "503", "unavailable", "timeout")
    if any(word in lowered for word in transient):
        return False
    return any(
        word in lowered
        for word in ("400", "invalid_argument", "not supported", "unsupported", "not enabled")
    )


RETRY_DELAYS = (5.0, 20.0)


def _call_with_retry(case: "ProbeCase", daily_cap: DailyCap) -> Observation:
    """Call once, and retry transient provider errors with backoff.

    Each retry is a real provider call, so it is charged to the daily cap.
    """
    for attempt in range(len(RETRY_DELAYS) + 1):
        try:
            return case.call()
        except Exception as exc:  # provider errors are data for the probe
            error = f"{type(exc).__name__}: {exc}"[:800]
            if is_capability_error(error) or attempt == len(RETRY_DELAYS):
                return Observation(error=error)
            time.sleep(RETRY_DELAYS[attempt])
            try:
                daily_cap.charge(1)
            except DailyCapReached as cap:
                return Observation(error=str(cap))
    raise AssertionError("unreachable")


@dataclass
class ProbeCase:
    """One trial: the request to record, how to send it, and how to score it."""

    request: dict[str, Any]
    call: Callable[[], Observation]
    score: Callable[[Observation], bool]


def run_trials(
    *,
    capability: str,
    model: str,
    path: Path_,
    cases: list[ProbeCase],
    daily_cap: DailyCap,
) -> ProbeResult:
    """Run each case once, keep every transcript, and vote.

    A provider error that says the feature is unsupported counts as a fail,
    because that is a real answer about the capability. Transient errors such as
    rate limits count as errors and push the outcome toward inconclusive.
    """
    results: list[Trial] = []
    for index, case in enumerate(cases):
        try:
            daily_cap.charge(1)
        except DailyCapReached as exc:
            results.append(Trial(passed=None, observed="", evidence_id="", error=str(exc)))
            break
        started = time.monotonic()
        obs = _call_with_retry(case, daily_cap)
        passed: bool | None
        if obs.error:
            passed = False if is_capability_error(obs.error) else None
        else:
            passed = case.score(obs)
        evidence_id = evidence.save(
            "probe",
            {
                "capability": capability,
                "model": model,
                "path": path,
                "trial": index + 1,
                "request": case.request,
                "response": asdict(obs),
                "passed": passed,
                "ms": int((time.monotonic() - started) * 1000),
            },
        )
        observed = obs.error or obs.text or str(obs.tool_calls or obs.parsed)
        results.append(Trial(passed, observed[:300], evidence_id, obs.error))
    passes = sum(t.passed is True for t in results)
    fails = sum(t.passed is False for t in results)
    errors = sum(t.passed is None for t in results)
    return ProbeResult(
        capability, model, path, majority(passes, fails, errors), passes, fails, errors, results
    )

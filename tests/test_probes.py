from claimcheck.budget import DailyCap
from claimcheck.probes import tasks
from claimcheck.probes.base import Observation, ProbeCase, is_capability_error, majority, run_trials


def test_majority_rules() -> None:
    assert majority(3, 0, 0) == "pass"
    assert majority(1, 2, 0) == "fail"
    assert majority(1, 1, 1) == "inconclusive"
    assert majority(2, 0, 2) == "inconclusive"
    assert majority(0, 0, 0) == "inconclusive"


def test_capability_vs_transient_errors() -> None:
    assert is_capability_error("400 INVALID_ARGUMENT: audio input not supported")
    assert not is_capability_error("429 RESOURCE_EXHAUSTED quota")
    assert not is_capability_error("503 UNAVAILABLE high demand")


def test_tool_scorers() -> None:
    paris = Observation(tool_calls=[{"name": "get_weather", "args": {"city": "Paris, FR"}}])
    both = Observation(
        tool_calls=[
            {"name": "get_weather", "args": {"city": "Paris"}},
            {"name": "get_weather", "args": {"city": "Tokyo"}},
        ]
    )
    assert tasks.score_tool_calling(paris)
    assert not tasks.score_tool_calling(Observation(text="It is sunny in Paris"))
    assert tasks.score_parallel(both) and not tasks.score_parallel(paris)
    assert tasks.score_tool_choice(Observation(tool_calls=[{"name": "add_numbers", "args": {}}]))


def test_structured_scorer() -> None:
    good = Observation(parsed={"title": "Dune", "author": "Frank Herbert", "year": 1965})
    assert tasks.score_structured(good)
    assert not tasks.score_structured(
        Observation(parsed={"title": "Dune", "author": "x", "year": 1965})
    )
    assert not tasks.score_structured(Observation(text='{"title": "Dune"}'))
    assert tasks.parse_json_text('{"a": 1}') == {"a": 1}
    assert tasks.parse_json_text("[1]") is None


def test_image_case_is_deterministic_and_scored() -> None:
    first, again = tasks.make_image_case(4), tasks.make_image_case(4)
    assert first == again
    answer = Observation(text=f"{first.word} {first.number} {first.color}")
    assert tasks.score_image(answer, first)
    assert not tasks.score_image(Observation(text=first.word), first)


def test_audio_fixtures_and_scorer() -> None:
    cases = tasks.audio_cases()
    assert {c.digits for c in cases} == {"39147", "80526", "61390"}
    case = cases[0]
    assert tasks.score_audio(Observation(text=f"{case.digits[:2]} {case.digits[2:]}"), case)
    assert not tasks.score_audio(Observation(text="12345"), case)


def test_run_trials_votes_and_keeps_transcripts(tmp_path) -> None:
    cap = DailyCap(tmp_path / "usage.json", limit=10)
    answers = iter([True, False, True])

    def case() -> ProbeCase:
        ok = next(answers)
        return ProbeCase(
            {"p": 1}, lambda: Observation(text="yes" if ok else "no"), lambda o: o.text == "yes"
        )

    result = run_trials(
        capability="tool_calling",
        model="m",
        path="langchain",
        cases=[case(), case(), case()],
        daily_cap=cap,
    )
    assert (result.passes, result.fails, result.outcome) == (2, 1, "pass")
    assert all(t.evidence_id for t in result.trials)
    assert cap.used() == 3


def test_unsupported_error_is_a_fail_not_an_error(tmp_path) -> None:
    cap = DailyCap(tmp_path / "usage.json", limit=10)

    def boom() -> Observation:
        raise RuntimeError("400 INVALID_ARGUMENT: audio input not supported")

    cases = [ProbeCase({}, boom, lambda o: True) for _ in range(3)]
    result = run_trials(
        capability="audio_inputs", model="m", path="langchain", cases=cases, daily_cap=cap
    )
    assert result.outcome == "fail" and result.errors == 0


def test_daily_cap_stops_trials(tmp_path) -> None:
    cap = DailyCap(tmp_path / "usage.json", limit=1)
    cases = [ProbeCase({}, lambda: Observation(text="ok"), lambda o: True) for _ in range(3)]
    result = run_trials(
        capability="tool_calling", model="m", path="langchain", cases=cases, daily_cap=cap
    )
    assert result.passes == 1 and result.errors == 1 and result.outcome == "inconclusive"

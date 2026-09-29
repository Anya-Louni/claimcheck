"""Probe tasks: fixed inputs with known answers and deterministic scorers.

Every task is the same for both call paths, so a difference between the
LangChain path and the provider SDK path points at the integration layer.
"""

import io
import json
import random
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont

from claimcheck.config import ROOT
from claimcheck.probes.base import Observation

WEATHER_TOOL = {
    "name": "get_weather",
    "description": "Get the current weather for a city.",
    "parameters": {
        "type": "object",
        "properties": {"city": {"type": "string", "description": "City name"}},
        "required": ["city"],
    },
}
ADD_TOOL = {
    "name": "add_numbers",
    "description": "Add two integers.",
    "parameters": {
        "type": "object",
        "properties": {"a": {"type": "integer"}, "b": {"type": "integer"}},
        "required": ["a", "b"],
    },
}
BOOK_SCHEMA = {
    "title": "Book",
    "type": "object",
    "properties": {
        "title": {"type": "string"},
        "author": {"type": "string"},
        "year": {"type": "integer"},
    },
    "required": ["title", "author", "year"],
}

TOOL_CALLING_PROMPT = "What is the weather in Paris right now? Use the get_weather tool."
TOOL_CHOICE_PROMPT = "Tell me one short fact about owls."
PARALLEL_PROMPT = (
    "Get the current weather for Paris and for Tokyo. "
    "Call get_weather for both cities in the same response."
)
STRUCTURED_PROMPT = (
    "Extract the book from this sentence: "
    "'Dune was written by Frank Herbert and published in 1965.'"
)
IMAGE_PROMPT = (
    "The image shows one word, one four digit number, and one filled circle. "
    "Reply on one line as: WORD NUMBER COLOR"
)
AUDIO_PROMPT = "Transcribe the digits spoken in this audio. Reply with numerals only, no spaces."


def _called(obs: Observation, name: str) -> list[dict[str, Any]]:
    return [c for c in obs.tool_calls if c.get("name") == name]


def score_tool_calling(obs: Observation) -> bool:
    return any(
        "paris" in str(c["args"].get("city", "")).lower() for c in _called(obs, "get_weather")
    )


def score_tool_choice(obs: Observation) -> bool:
    """The forced tool must be called even though the prompt does not need it."""
    return bool(_called(obs, "add_numbers"))


def score_parallel(obs: Observation) -> bool:
    cities = {str(c["args"].get("city", "")).lower() for c in _called(obs, "get_weather")}
    return any("paris" in c for c in cities) and any("tokyo" in c for c in cities)


def score_structured(obs: Observation) -> bool:
    data = obs.parsed
    if data is None:
        return False
    return (
        str(data.get("title", "")).strip().lower() == "dune"
        and "herbert" in str(data.get("author", "")).lower()
        and data.get("year") in (1965, "1965")
    )


def parse_json_text(text: str) -> dict[str, Any] | None:
    """Parse a JSON object from model text, or None."""
    try:
        value = json.loads(text)
    except (json.JSONDecodeError, TypeError):
        return None
    return value if isinstance(value, dict) else None


# Image probe ---------------------------------------------------------------

WORDS = ("ORBIT", "MAPLE", "CANYON", "PIXEL", "HARBOR", "VELVET", "TUNDRA", "LANTERN")
COLORS = {
    "red": (220, 30, 30),
    "green": (20, 150, 60),
    "blue": (30, 70, 220),
    "yellow": (240, 200, 0),
}


@dataclass(frozen=True)
class ImageCase:
    word: str
    number: str
    color: str
    png: bytes


def make_image_case(seed: int) -> ImageCase:
    """Render a test image with known content. Same seed, same image."""
    rng = random.Random(seed)
    word = rng.choice(WORDS)
    number = str(rng.randint(1000, 9999))
    color = rng.choice(sorted(COLORS))
    image = Image.new("RGB", (640, 360), "white")
    draw = ImageDraw.Draw(image)
    font = ImageFont.load_default(size=64)
    draw.text((40, 60), word, fill="black", font=font)
    draw.text((40, 180), number, fill="black", font=font)
    draw.ellipse((440, 110, 580, 250), fill=COLORS[color])
    out = io.BytesIO()
    image.save(out, format="PNG")
    return ImageCase(word, number, color, out.getvalue())


def score_image(obs: Observation, case: ImageCase) -> bool:
    text = obs.text.upper()
    return case.word in text and case.number in text and case.color.upper() in text


# Audio probe ---------------------------------------------------------------

AUDIO_DIR = ROOT / "fixtures" / "audio"


@dataclass(frozen=True)
class AudioCase:
    digits: str
    wav: bytes


def audio_cases(directory: Path = AUDIO_DIR) -> list[AudioCase]:
    """Load the offline-synthesized digit clips. File names hold the ground truth."""
    return [
        AudioCase(path.stem.removeprefix("digits_"), path.read_bytes())
        for path in sorted(directory.glob("digits_*.wav"))
    ]


def score_audio(obs: Observation, case: AudioCase) -> bool:
    return re.sub(r"\D", "", obs.text) == case.digits

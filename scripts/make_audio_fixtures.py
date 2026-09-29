"""Synthesize the spoken-digit clips used by the audio probe, fully offline.

Uses pyttsx3, which drives the operating system's speech engine (SAPI5 on
Windows, eSpeak on Linux). The digits are fixed so the ground truth never changes.
"""

from pathlib import Path

import pyttsx3

DIGITS = ("39147", "80526", "61390")
OUT = Path(__file__).resolve().parents[1] / "fixtures" / "audio"


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    engine = pyttsx3.init()
    engine.setProperty("rate", 140)
    for digits in DIGITS:
        engine.save_to_file(", ".join(digits), str(OUT / f"digits_{digits}.wav"))
    engine.runAndWait()
    for digits in DIGITS:
        print(OUT / f"digits_{digits}.wav")


if __name__ == "__main__":
    main()

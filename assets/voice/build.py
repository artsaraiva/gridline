# /// script
# requires-python = ">=3.12,<3.13"
# dependencies = ["kokoro", "numpy", "soundfile"]
# ///
"""Build the Voice Line WAV files (#83, ADR 0003).

Runs Kokoro-82M locally over the phrases in `lines.json` (phrase id -> spoken text; the Vitest check in
`src/console/voice.test.ts` reads the same file) and writes one clean take per id next to this script:
mono, 24 kHz, 16-bit PCM, leading and trailing silence trimmed to a few ms of padding, no radio
treatment (the band-limiting happens at runtime, in one place). One voice at one speed for every line:
`af_heart`, the only A-grade voice in Kokoro's VOICES.md. Adding a line is an entry in `lines.json`,
a re-run and a commit of the WAV.

Serving: the WAVs stay here and the Console imports them with Vite's `?url`
(`import url from '../../assets/voice/uav-inbound.wav?url'`), so `public/` keeps only baked sprites.

Run from the repository root (uv fetches Python 3.12, torch and the model weights on first run):
  uv run assets/voice/build.py
"""
import json
import os

import numpy as np
import soundfile as sf
from kokoro import KPipeline

HERE = os.path.dirname(os.path.abspath(__file__))
VOICE = "af_heart"
SPEED = 1.0
RATE = 24000
PAD = int(0.02 * RATE)  # 20 ms either side of the trimmed take
GATE = 0.01  # trim at -40 dBFS relative to the take's peak

with open(os.path.join(HERE, "lines.json")) as f:
    lines: dict[str, str] = json.load(f)

pipeline = KPipeline(lang_code="a", repo_id="hexgrad/Kokoro-82M")
for id_, text in lines.items():
    results = list(pipeline(text, voice=VOICE, speed=SPEED))
    audio = np.concatenate([r.audio.numpy() for r in results])
    loud = np.flatnonzero(np.abs(audio) > GATE * np.abs(audio).max())
    audio = audio[max(0, loud[0] - PAD) : loud[-1] + PAD]
    sf.write(os.path.join(HERE, f"{id_}.wav"), audio, RATE, subtype="PCM_16")
    print(f"{id_:24} {len(audio) / RATE:4.2f}s  peak {np.abs(audio).max():.2f}  {' '.join(r.phonemes for r in results)}")

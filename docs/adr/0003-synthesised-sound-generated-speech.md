---
status: superseded by ADR-0004
---

# Sound is synthesised at runtime, except speech, which a committed script generates offline

Every sound the Console plays (radio squelch and buzz, Chatter, distant guns, explosions, shell whistle, UAV hum, parachute) is synthesised with Web Audio at runtime, so variants are free and nothing is licensed. The one exception is Voice Lines: a script in `assets/voice/` generates them with Kokoro-82M (weights under Apache 2.0, voice checked against its VOICES.md) and commits the WAV files next to it, the same shape as ADR 0001's Blender scripts and GLBs. This replaces the "Web Audio synthesis only, no samples" rule from [the Skirmish slice spec](https://github.com/artsaraiva/gridline/issues/28). See [Audio rework](https://github.com/artsaraiva/gridline/issues/56).

## Considered Options

- **All synthesis, no speech**: keeps the repo free of audio files, but the Commander never hears a confirmation or a warning, and the radio stays a buzz.
- **Sample libraries for guns and explosions**: every file needs a licence check for a public repo, and fixed samples fatigue faster than randomised synthesis. Distant lo-fi battle sound through a tablet speaker does not need them.
- **Piper for speech**: permissive engine, but each voice carries its own licence (research-only and non-commercial voices among them). Kokoro has one licence for its weights.
- **Paid voice services**: outputs come with provider terms, and a public repo redistributes every byte.

## Consequences

- The radio band-limiting of a Voice Line happens at runtime, so the WAV is a clean take and the radio treatment lives in one place.
- Adding a Voice Line means editing the script, re-running it and committing the WAV with it. CI never runs Kokoro.
- One HQ voice speaks every Voice Line, the two NET warnings ("<Point> lost", "<Squad> wiped") among them. Squad Callouts stay buzz plus typed text, so speech always means HQ or the Asset net.
- The HQ voice is Kokoro's `af_heart` (American English, the only voice graded A in its VOICES.md; the best male voices there are C+). The Kokoro-82M weights are Apache 2.0, and its model card states the model was trained only on permissive or non-copyrighted audio (Apache- and MIT-licensed audio and synthetic audio from closed TTS providers). VOICES.md attaches CC BY attributions only to its Japanese and French voices, so the English voice carries no attribution requirement. `assets/voice/build.py` names the voice; the phrase list is `assets/voice/lines.json`.

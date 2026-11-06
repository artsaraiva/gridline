---
status: accepted
supersedes: ADR-0003
---

# Every sound cue is cut; replacements are real recordings, added one cue at a time

The synthesised cues of ADR 0003 (buzz transmissions, a buzz Chatter every few seconds, synth guns, explosions, whistle, hum and parachute) and the generated HQ voice did not sound like a live military radio net or a battle heard from above, so all of them were removed ([#88](https://github.com/artsaraiva/gridline/issues/88)). The engine stays: buses, mute, ducking, repetition gates, observability rule, spatial chain and loop bookkeeping, with every cue a silent stub in one table in `src/console/audio.ts`. Future cues are real recordings under CC0 or US Government public domain (freesound.org with the CC0 filter, DVIDS footage), checked per file and credited in the repo, never Battlefield's own audio. Chatter becomes one faint looping bed of real radio traffic, not scheduled transmissions. Speech is off the table until a source sounds right.

## Consequences

- The Kokoro pipeline (`assets/voice/`, `build.py`, `lines.json`) and its Vitest check are gone; speech, if it returns, starts from a new decision.
- The Squad Net log types its lines with no sound; a line on air still ducks the chatter and combat buses, so a sampled radio cue inherits that.
- A sampled cue is one function in the `CUE` table (or `transmit`), fed into the existing spatial chain; gates, buses and mute apply to it unchanged.
- Each added recording lands with its licence and source URL in a credits file, one issue per cue.

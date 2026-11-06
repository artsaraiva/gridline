# Coding standards

Rules for review. `pnpm typecheck`, `pnpm test` and `pnpm test:replay` already enforce what they can; these are the judgement calls they cannot.

## Baked sprites

Baked sprites are Blender renders under `assets/` packed into sheets under `public/` (ADR 0001, ADR 0002). Their light is part of the picture.

- **Light stays with the map sun.** At runtime a baked sprite turns by at most half a baked heading step. An object that flies or turns through more than that bakes one frame per heading and the Console picks the nearest (`shellInFlight`, `scanUav` in `src/console/sprites.ts`). Flag any sprite rotated by a full heading, unless it is a shadow or a top-down shape with no lit side.
- **Bake-fixed values come from the bake.** A Console constant whose correct value is set by a Blender script (frame counts, headings, world size of a frame, an offset measured in the scene) is written into that script's sheet `.json` under `constants`, keyed by its export name in `sprites.ts`. The sprite-sheet test then checks it. Flag a constant that mirrors a `build.py` value without that entry.

## Simulation (`src/sim`)

- **Attribution sits inside the branch that causes the change.** A field that records who or what caused a state change (`Soldier.cause`, `uavAssist`, `Squad.takingSince`) is written in the same branch that makes the change, never beside it on a wider condition. A Barrage that stamps every enemy in its Wound ring claims deaths it never caused.
- **New state is hashed.** Every new mutable field on `Match`, `Soldier`, `Squad`, `Point`, an `Effect` or an `Order` is mixed into `stateHash` by its module's `hashX`, and a test shows the hash moves when it changes. Float fields go in as `Math.round(v * 1000)`.
- **Deterministic arithmetic.** Rules touch floats only with `+ - * /` and `Math.sqrt`. `Math.hypot`, trig, `Date`, `Math.random` and object-key order that is not integer-ascending are out.
- **Rules carry their reason.** A rule that departs from the spec's literal wording (a derived hold Order counting on a retake, a crate that never announces at match end) records the judgement in a one-line comment where the rule lives.
- **Awards never leak fog.** An `award` reason names no position and no enemy the Commander's Side has not seen.

## Tune and types

- Tune keys and view fields go under the ticket's own `// #NN` heading at the end of the block. A spec's tracer ticket may add the whole spec's keys under the spec's heading.
- New `CommanderView` and `SquadView` fields are optional (`?`), so view literals in other tickets' tests still typecheck.

## Console (`src/console`)

- Text on the Console uses `GLOSSARY.md` terms as written there.
- Pure formatters (`summary.ts`) carry a unit test; DOM code stays thin and untested.

## Commits and PRs

- `feat(#NN): ...` / `fix(#NN): ...`, plain prose, no AI attribution lines.

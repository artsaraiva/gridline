# Coding standards

Rules for review. `pnpm typecheck`, `pnpm test` and `pnpm test:replay` already enforce what they can; these are the judgement calls they cannot.

## Baked sprites

Baked sprites are Blender renders under `assets/` packed into sheets under `public/` (ADR 0001, ADR 0002). Their light is part of the picture.

- **Light stays with the map sun.** At runtime a baked sprite turns by at most half a baked heading step. An object that flies or turns through more than that bakes one frame per heading and the Console picks the nearest (`shellInFlight`, `scanUav` in `src/console/sprites.ts`). Flag any sprite rotated by a full heading, unless it is a shadow or a top-down shape with no lit side.
- **Bake-fixed values come from the bake.** A Console constant whose correct value is set by a Blender script (frame counts, headings, world size of a frame, an offset measured in the scene) is written into that script's sheet `.json` under `constants`, keyed by its export name in `sprites.ts`. The sprite-sheet test then checks it. Flag a constant that mirrors a `build.py` value without that entry.

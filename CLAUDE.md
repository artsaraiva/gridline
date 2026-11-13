## Agent skills

### Issue tracker

Issues live in GitHub Issues for artsaraiva/gridline (via `gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary: needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` + `docs/adr/` at repo root. See `docs/agents/domain.md`.

### Visual checks

To check baked Assets by eye, run `pnpm review:capture` (screenshots the DEV Asset review scene per Asset; options in `scripts/review-capture.mjs`).

## Navigation

- **Simulation**: start at `src/sim/index.ts` (tick order, public surface, `stateHash`); each rule module hashes its own state. `src/sim/fog.test.ts` asserts the exact `CommanderView` key set.
- **Coding standards**: `CODING_STANDARDS.md`, read by `/code-review`.
- **Baked Assets**: one module per Asset, `src/console/sprites/<asset>.ts` (sheet entry, pose maths, test) and `src/console/layers/<asset>.ts` (drawing on `pool()`); `sprites/sheet.ts` is the shared loader and `sheet.test.ts` checks every sheet against its bake `.json`.
- **Console look review** of a new event or chrome element: add a chapter to `src/console/dev/commander-review-timeline.ts` and open `/dev-commander-review.html` under `pnpm dev`; `/dev-asset-review.html` cycles the Assets on the real Simulation.
- **Design system**: the console's look (tokens, chrome components, map symbology and effects, icons, sprites) is the Gridline Design System artifact, https://claude.ai/artifact/Fty3LPTJNbEzUH1NQnrhuY; read its README with the Artifact tool before designing new chrome or map marks. The code stays the source of truth: after a look change, re-sync the artifact from it.
- **Checks**: `pnpm test && pnpm typecheck && pnpm build && pnpm test:replay`. Run them inside a worktree; `test:replay` takes `PORT` when two runs share a machine.

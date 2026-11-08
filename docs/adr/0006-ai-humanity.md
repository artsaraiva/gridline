---
status: accepted
---

# Seeded Traits make the AI human; variety in what, not when

Every Squad and every Soldier draws Traits from the Match RNG once, at match start, and keeps them for the match: a Squad's preference per Capture Point, its aggression, its think tempo and how far it walks before it rides; a Soldier's reaction. Choices that used to take the single best option now draw among the near-best, weighted by score, and a Squad holds its choice for a seeded Commitment. We chose this because the AI read as one machine: every Squad took the same best point at the same moment from the same spot, so on a mirrored map both Sides did the same thing, and a Commander watching from above sees that at once. Players leave their squads, pick different flanks and take the helicopter somewhere odd; Gridline's Squads should feel like that crowd, not like a solver. See [AI humanity](https://github.com/artsaraiva/gridline/issues/118).

The variety goes into what agents choose (where, which way, which spot), not into when they act: any added pause stays under about a second or comes with a cue the Console already shows. Bungie removed Halo's perception delay because players read it as the AI being broken. A Commander's Order stays absolute: Traits shape only what a Squad chooses for itself. Both Sides draw from the same distributions, and Traits never show on the Console.

## Considered Options

- **Fresh randomness at every decision.** Cheap, but a Squad that re-rolls each think dithers, and nothing about it is a character the Commander can learn.
- **Perception and reaction delays.** The usual "make it human" lever, but it reads as broken or sluggish from above (Bungie's Halo experience), and it changes every firefight's balance.
- **A Commander layer first** (one strategic AI per Side handing out points, as in Battlefield 1942, Halo 3, Killzone 2). It spreads Squads, but by plan: tidier, not more human. Deferred until seeded choice shows whether it is still needed.
- **Learned or adaptive AI.** Out of proportion to the problem, and not replayable from a seed.

## Consequences

- All of it is deterministic: Traits and draws come from the Match RNG and every new piece of state is hashed, so a seed still replays the same match.
- A Squad's behaviour is no longer predictable from the map alone. Tests assert ranges, spreads across seeds and same-seed repeatability instead of one exact choice; `pnpm balance` reports first picks and helicopter Landing Zones and checks that neither Side is favoured.
- Orders gain value: the Commander's Order is the one way to make a Squad go somewhere for sure.
- Tuning moves from single values to ranges, and each knob sits under its spec's heading in `tune.ts`.

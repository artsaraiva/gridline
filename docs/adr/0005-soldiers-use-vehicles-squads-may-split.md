---
status: accepted
---

# Soldiers, not Squads, use vehicles; a Squad may split

Vehicles have no crew of their own. A Soldier boards a seat on their own decision and leaves it on their own decision, so a Squad can be spread over a tank, a jeep and the road between them, and a passenger who rides past a better Capture Point hops out for it. A Soldier away from their Squad is Detached: they pick a goal from their own position, with a `squadPull` bonus on the Squad's goal and the Order's bonus still applied, and drift back to the Squad. We chose this because Gridline emulates BF4 Commander, which is played over a real Conquest match where players leave their squads, take whatever vehicle is free and go where they like; a Commander whose Squads always moved as one body would be commanding something tidier than the fantasy. See [Vehicles: crews, movement and combat](https://github.com/artsaraiva/gridline/issues/27).

## Considered Options

- **Dedicated Crew Squads sized to the seats** (tank 2, jet 1), born and dying with the vehicle, taking Orders like infantry. Zero change to the one-body Squad AI, but crews on the Squad rail and vehicles that are never empty are not BF4, and nobody ever boards or leaves anything.
- **A whole infantry Squad crews any vehicle, seats abstract.** Keeps Squads whole, but a 4-man jet is nonsense and the player wanted real seat counts.

## Consequences

- The Squad AI of #34 assumed one body round its first living member (wedge, leash, regroup, bounding, flanking, revive range). Detached Soldiers are excluded from those rules the way a chaser or a #93 stray is today, and the wedge forms on the first living on-foot member, while the Squad Leader stays roster member 0 wherever they sit.
- An Order pulls Soldiers, not a body: compliance is loose by design, and `squadPull` is the one knob between "BF4 pubs" and "disciplined". Order state on the Squad card is derived from the Squad's goal as before.
- Tickets and Commander Score stay per Soldier: a vehicle's death costs its occupants, nothing more, and earns the enemy Commander only the occupants a Strike killed.
- Detached ships before any vehicle, so its effect on plain infantry play is seen on its own.

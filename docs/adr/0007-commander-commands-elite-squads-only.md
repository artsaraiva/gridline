---
status: accepted
---

# The Commander commands Elite Squads only

At 128 v 128 a Side has 32 Squads of 4. Only a fixed number of them, the Elite Squads (`eliteSquads`, 8), take the Commander's Orders, send Requests and Callouts, and show on the Squad rail. The rest play for themselves, as enemy Squads always have, and appear on the Console as plain friendly Soldiers. We chose this because the BF4 Commander, our reference, handled a handful of squads: taken one to one, 32 Squads turn the Commander into an RTS player and fill the map with marks. In a BF4 pub only some squads listen to the Commander, and ADR 0005 already asks for that messy pub behaviour. See [the Commander's span of control](https://github.com/artsaraiva/gridline/issues/153).

Elite means only the link to the Commander. Elite Squads draw their Soldiers and Traits exactly as other Squads do, with no stat bonus (#58 rules out stat buffs on Squads). Which Squads are Elite is fixed for the match, and there is no verb to promote or swap one. At 8 Squads per Side or fewer every Squad is Elite, so Kaltenbach plays as it did before.

## Considered Options

- **Direct.** Every Squad takes Orders, and the rail groups or scrolls, with Order lines only for the selected Squads. Rejected: the Commander would have to know 32 Squads to choose one, which is the RTS problem the reference avoids.
- **Platoons.** 8 Platoons of 4 Squads, each with an AI lead spreading its Squads over the points. Rejected: a new domain term (the glossary lists platoon under _Avoid_), an AI layer between the Commander and the Squads, and a blur over who decided what.
- **Bigger Squads.** 8 Soldiers per Squad gives 16 Squads, still twice today's maximum, and an 8-Soldier Squad is a Platoon by another name.
- **A promote or swap verb.** It brings back the need to know all 32 Squads, and BF4 had nothing like it.

## Consequences

- The Console, the radio and the Requests stay sized for 8 Squads, and so does the Side's radio volume: Squads that are not Elite send nothing, so the Side needs no shared radio budget. The one Side-level line they cause is a capture with no Elite Squad inside, reported once on the Side net the way a loss already is.
- Most of the Side is outside the Commander's direct reach. The Commander moves it through what every Squad shares: Assets (crates, Strikes, Scans), Contacts, and the Side's knowledge.
- The enemy Side still has no Commander, so its 32 Squads all play for themselves. An AI Commander would be a spec of its own.

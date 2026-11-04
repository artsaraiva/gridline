# Gridline

A browser game where the player is the commander of one side in a simulated battle, seeing it only from above.

## Language

**Commander**:
The player's role: one side's leader, who sees the battlefield only from above and acts through orders and assets, never by fighting directly.
_Avoid_: Player (ambiguous once soldiers exist), general

**Squad**:
A small group of AI-controlled soldiers on one side that moves and fights as a unit and takes orders from its commander.
_Avoid_: Unit, team, platoon

**Soldier**:
One AI-controlled combatant, always a member of a squad.
_Avoid_: Bot, player, unit

**Soldier Cam**:
A live camera the Commander opens on one soldier from the map, following that soldier in action; the Commander watches through it but never controls the soldier.
_Avoid_: Player cam, first-person view, spectate

**Side**:
One of the two opposing forces in a match; the Commander leads one Side.
_Avoid_: Team, army

**Faction**:
The identity a Side wears in a match, such as NATO or the Warsaw Pact: its name, emblems and look. The two Factions always oppose each other, and the player may command either.
_Avoid_: Side (for the identity), nation, country

### Match

**Skirmish**:
A match where the enemy side fields squads but has no commander.
_Avoid_: Bot match, practice

**Capture Point**:
A marked zone on the map that a side owns by having more living soldiers inside it than the enemy; it stays owned until enemies take it.
_Avoid_: Flag, objective, control point

**Ticket**:
One unit of a side's remaining strength; a side loses tickets when its soldiers die and when the enemy holds more capture points.
_Avoid_: Score, points, lives

**HQ**:
A side's base at its own map edge that can never be captured; where vehicles wait and wiped squads can redeploy.
_Avoid_: Main base, spawn, deployment

**Squad Respawn**:
A dead soldier returning to the fight next to their living squad.
_Avoid_: Squad spawn, buddy spawn

**Redeploy**:
A wiped squad returning to the fight as a whole from its HQ or a capture point its side owns.
_Avoid_: Respawn (for whole squads), reinforce

### Commander view

**Contact**:
An enemy soldier or vehicle the Commander currently knows about, because a friendly soldier sees it or a commander asset reveals it.
_Avoid_: Spot, blip, target

**Last Known Position**:
Where a Contact was last seen; it shows briefly after contact is lost, then fades.
_Avoid_: Ghost, echo

### Commander actions

**Order**:
A standing directive from the Commander to one Squad, naming a capture point to take or hold; the squad weighs it against its own situation and usually, not always, follows it.
_Avoid_: Command, asset, squad order (as an asset)

**Asset**:
A limited Commander ability that acts on the battlefield directly, such as a scan, a supply drop or a strike, and is unavailable for a while after use.
_Avoid_: Ability, power, perk, call-in

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

**Squad Leader**:
An identified Soldier who represents their Squad, distinct from the Commander. Leadership is an identity, not a source of combat bonuses or authority over the Commander's Orders.
_Avoid_: Commander (for the Soldier), squad commander

**Soldier Cam**:
A small monitor feed on the Commander's Console showing one friendly soldier's helmet camera, degraded and jammed like a real field feed; the Commander watches through it but never controls the soldier.
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

**Play Area**:
The part of the map inside its boundary where the battle happens; the land beyond is shown but never fought over.
_Avoid_: Map (for the bounded part), arena, battlefield

**Lane**:
One of the three corridors running from HQ to HQ across the front, each passing through one of the three Capture Points on the border spine.
_Avoid_: Flank, sector, route

**Ticket**:
One unit of a side's remaining strength; a side loses tickets when its soldiers die and when the enemy holds more capture points.
_Avoid_: Score, points, lives

**Commander Score**:
A per-match measure of the Commander's useful contribution through Orders and Assets, separate from Tickets. It recognizes outcomes rather than serving as spendable currency or unlocking Assets.
_Avoid_: Tickets, currency, experience points

**HQ**:
A side's base at its own map edge that can never be captured; where vehicles wait and wiped squads can redeploy.
_Avoid_: Main base, spawn, deployment

**Wounded**:
A soldier who has been shot down but is not yet dead; a squad mate can revive them before they bleed out, and only if they die does their side lose a ticket.
_Avoid_: Downed, incapacitated, dead (until they bleed out)

**Revive**:
A squad mate bringing a Wounded soldier back into the fight where they fell.
_Avoid_: Heal, respawn

**Squad Respawn**:
A dead soldier returning to the fight next to their living squad.
_Avoid_: Squad spawn, buddy spawn

**Redeploy**:
A wiped squad returning to the fight as a whole from its HQ or a capture point its side owns.
_Avoid_: Respawn (for whole squads), reinforce

### Commander view

**Console**:
The Commander's station in the command post: the map display, the radio, and the controls for Orders and Assets. Everything the player sees is on the Console.
_Avoid_: HUD, dashboard, tablet

**Contact**:
An enemy soldier or vehicle the Commander currently knows about, because a friendly soldier sees it or a commander asset reveals it.
_Avoid_: Spot, blip, target

**Last Known Position**:
Where a Contact was last seen; it shows briefly after contact is lost, then fades.
_Avoid_: Ghost, echo

### Commander actions

**Order**:
A standing directive from the Commander to one Squad, naming a capture point to take or hold; the squad weighs it against its own situation and may delay it to survive, but never drops it. Only the Commander clears or replaces an Order.
_Avoid_: Command, asset, squad order (as an asset)

**Asset**:
A limited Commander ability that acts on the battlefield directly, such as a scan, a supply drop or a strike, and is unavailable for a while after use.
_Avoid_: Ability, power, perk, call-in

### Radio

**Callout**:
A radio line a Squad sends on its own to report an event, naming the Grid Reference when the event has a location. The Commander's own radio lines are not Callouts.
_Avoid_: Message, notification, alert

**Request**:
A Callout in which a Squad asks the Commander for a specific Asset at a Grid Reference; it stays open until the Asset answers it or it expires.
_Avoid_: Call-in, ask

**Grid Reference**:
The name of one square of the map grid, a letter column plus a number row, such as E5.
_Avoid_: Coordinate, sector

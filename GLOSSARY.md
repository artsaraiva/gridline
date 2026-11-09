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

**Trait**:
A seeded value of a Squad's or Soldier's character, fixed for the match: a Squad's preference per Capture Point, aggression, think tempo and how far it walks before it rides; a Soldier's reaction. Traits shape only what they choose for themselves, never an Order, and never show on the Console.
_Avoid_: Personality (as a mechanic), stat, skill level, difficulty

**Commitment**:
How long a Squad (or a Detached Soldier) holds a Capture Point it chose for itself before it weighs the points again; only a real event ends it early.
_Avoid_: Stickiness (the score bonus at a re-pick), lock, cooldown

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

### Vehicles

**Vehicle**:
A machine of one Side that Soldiers ride and fight from: tank, jeep, transport helicopter, jet or anti-air gun. It waits empty or crewed in a fixed slot at its HQ and returns there a while after it is destroyed.
_Avoid_: Unit, armour (for all vehicles), asset

**Mounted**:
The state of a Soldier riding a Vehicle in one of its seats: they move with it, see and fire from it and cannot be shot, suppressed or Wounded until they get out or it is destroyed. Soldiers board and leave Vehicles one by one, so a Squad may be partly Mounted.
_Avoid_: In the vehicle, embarked, loaded

**Detached**:
A Soldier acting away from their Squad on a goal of their own, usually after riding a Vehicle elsewhere; they drift back toward the Squad's goal and rejoin once back with the Squad on it.
_Avoid_: Lone wolf, stray (the brief wander within a leash), split squad

**Crew**:
The Soldiers who man a helicopter's pilot and gun seats for a stint: each is sent by a different Squad while the helicopter stands on its helipad (never a Squad Leader, at most one per Squad), stays a member of their Squad though Detached, and walks back to it once the stint is over on the helipad. A ground Vehicle's driver and gunner are not Crew.
_Avoid_: Pilot and gunners (as a separate class of Soldier), air crew

**Parachute (jump)**:
How a Soldier leaves a helicopter in the air: they come down over a few seconds, drift a little from where they jumped, cannot fire or count in a Capture Point meanwhile, and are on foot when they land.
_Avoid_: Bail (the helicopter's own job), drop (the Ferry's hot-goal run), fast rope

**Wreck**:
A destroyed Vehicle's hull, left where it died until its slot gives the Side a fresh one.
_Avoid_: Debris, corpse, destroyed vehicle (as a thing on the map)

**Launcher**:
The rocket weapon one Soldier of every Squad carries against Vehicles; rifles cannot hurt an armoured Vehicle.
_Avoid_: RPG, AT, bazooka

**Landing Zone**:
Where a transport helicopter sets down for its passengers' goal: a spot near the Capture Point, away from the enemies they know about, chosen afresh each trip; the passengers walk in from there.
_Avoid_: LZ (in prose), drop point, helipad (the helicopter's slot at its HQ)

**Ferry**:
The helicopter job of fetching and carrying a Squad: a Squad on foot far from the HQ whose goal is a long ride, with no vehicle by it, calls the helicopter, which lands by it, takes it to its goal and sets it down at a Landing Zone; to a goal where any friendly Squad knows enemies it circles first so its gunners fire (with no gunner aboard it does not circle), then the riders jump by Parachute over the Landing Zone.
_Avoid_: Taxi, evac, air drop

**Sortie**:
A jet's round of passes from its Side's off-map base: each pass is an attack run at an enemy its Side knows near the Capture Point its pilot picks, its cannon raking the last stretch before it (a bomb on a vehicle or a group, while it has bombs), then it climbs out past the Play Area and turns for the next; an enemy jet met in the air is fought first; after the last pass it flies home and rearms with its pilot aboard.
_Avoid_: Strafing Run (the Commander Asset), attack run, mission

**Support**:
The helicopter job of circling a Capture Point where any friendly Squad knows enemies, so its side-gun gunners fire on them; the helicopter never circles without a gunner aboard. With nothing else to do it waits on its helipad.
_Avoid_: Gunship run, patrol, strafing

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

**Award**:
One addition to the Commander Score: its category (UAV, Supply, Artillery or Orders), its points and a short reason that names no position and no unseen enemy. The Console shows each Award briefly as it lands.
_Avoid_: Contribution message, bonus, reward, XP

### Commander actions

**Order**:
A standing directive from the Commander to one Squad, naming a capture point to take or hold; the squad weighs it against its own situation and may delay it to survive, but never drops it. Only the Commander clears or replaces an Order.
_Avoid_: Command, asset, squad order (as an asset)

**Asset**:
A limited Commander ability that acts on the battlefield directly, such as a scan, a supply drop or a strike, and is unavailable for a while after use.
_Avoid_: Ability, power, perk, call-in

**Strike**:
An Asset that damages an area of the map, such as the Artillery Barrage; every Strike warns before it lands, hits Soldiers of either Side and shows the enemies it catches as Contacts.
_Avoid_: Attack, fire mission, bombardment

**Cruise Missile**:
The Strike that flies in from beyond the Commander's own map edge to one chosen spot and lands a single large blast there; its whole approach is visible, and the flight is its warning.
_Avoid_: Missile strike, rocket, tomahawk

**Strafing Run**:
The Strike in which an aircraft flies in along a line the Commander chose, fires along it and flies off; the whole pass is visible.
_Avoid_: Airstrike, gun run, CAS

**Gunship**:
The Strike that orbits a chosen spot for a while, reveals the enemies under it as Contacts and shells them from the air.
_Avoid_: AC-130, Spooky, air support

**Scan UAV**:
The Asset that circles a chosen spot for a short time and reveals every enemy near it as a Contact, then as a Last Known Position.
_Avoid_: Drone, recon, radar

**Supply Drop**:
The Asset that drops a crate at a chosen spot; once landed it refills the ammunition and slowly heals friendly Soldiers near it for a while.
_Avoid_: Resupply, ammo box, care package

**Artillery Barrage**:
The Asset that, after a warning, lands a spread of shells round a chosen spot, killing, Wounding and suppressing Soldiers of either Side by their distance from each shell.
_Avoid_: Strike, airstrike, bombardment, arty

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

**Voice Line**:
An intelligible spoken radio line from HQ that confirms an Asset or warns the Commander; it is always also a line in the radio log.
_Avoid_: Voice over, speech sample, announcement

**Chatter**:
Indistinct, unlogged radio texture on the Squad net that carries no information.
_Avoid_: Ambient, background voice, gibberish

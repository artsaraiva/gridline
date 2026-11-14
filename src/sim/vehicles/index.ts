// Vehicles (#107, the tank tracer for the shared rules of #27; ADR 0005): each Side's slot, seats, boarding and leaving per
// Soldier, the drive step, the tank's eyes and guns, the kill table, Wrecks and the respawn. #108 adds the jeep, a transport:
// its passengers get out by the shared passenger rule (`wantsOut`), and its second seat fires an MG where the tank's has the coax. Soldiers and vehicles share one
// id space: a vehicle's id comes after every Soldier's (`vehicleOf` in state.ts), so sightings, targets and `shot` events
// address either. #109 adds the transport helicopter: it flies over the ground grid (`fly`; #124 by dogleg, in `flight.ts`), ferries its passengers to their
// majority's goal and home again, sees over walls, and is seen over walls while airborne. #119: the enemy's Console shows it only
// when someone of theirs sees it, as any vehicle. #131: a piloted helicopter takes a job at its pilot's Squad think (`decideJob`):
// bail, repair, ferry (fetch a Squad that calls it, carry riders, drop them over a hot goal), support (circle a point) or wait.
// #110 adds the jet (its sortie in `jet.ts`: one pilot, attack runs and bombs from the off-map base, dogfights; only the AA and
// the enemy jet hurt it) and the AA: a ground vehicle crewed alone like a tank that lays back on rear and flank points, its gun
// firing bursts at air first (a jet over the Play Area, else a helicopter), else at infantry and light vehicles, and its lock-on
// missile (`air-missiles.ts`) at air. #101 adds the Gunship: one body per Side, dormant until its Asset (assets/gunship.ts)
// wakes it and flies it along its route. Nobody pilots it; a Soldier coming back may take its gun seat (the left side gun) or
// one of its passenger seats, to parachute out over its goal (`gunshipOnReturn`); everyone aboard bails out as it turns for
// home or is shot down. Only the AA sees and hurts it, as a helicopter, and only over the Play Area, as a jet.
//
// #183: one folder, and this index its public surface (the names the one-file vehicles.ts exported). core.ts holds the shared
// rules, body.ts the Vehicle record and class data, seats.ts getting in and out, ground.ts the ground drive step (its route in
// drive-route.ts); each kind's own rules sit in its module: aa.ts, helicopter.ts (its jobs in helicopter-jobs.ts, its Landing
// Zones and doglegs in flight.ts), jet.ts, and lent.ts for the bodies Assets fly. `clearOfHq` is in geometry.ts.
export { crippled, flies, held, high, hold, live, riders, SPECS, wreck, type Round, type Vehicle, type VehicleOf, type Wreck } from './body';
export { board, boardOnReturn, boardStep, decideRide, drive, drivePoint, fitsRide, hashVehicles, hurt, isLauncher, lockMissiles, look, mainGuns, mount, newVehicles, ride, rocketTarget, seatFire, seeVehicles, targetOf, vehicleViews, type Shot, type Shots } from './core';
export { decideCrew, plan } from './helicopter';
export { deployPilots } from './jet';
export { sleep, wake } from './lent';
export { bail, CREW_SEATS, getOut, goalOf, gunner, jump, leave, onPad, PILOT_SEAT, sideGun } from './seats';

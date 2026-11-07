// Tanks on the map (#107): own tanks, enemy tanks in sight (the same sprite in its Faction's paint) and Wrecks; the baked hull
// at the nearest heading with the turret laid on its target over it, each with its ground shadow. sprites/tank.ts says how.
import type { CommanderView } from '../../sim/types';
import { pool } from '../renderer';
import { spriteMesh } from '../sprites/sheet';
import { TANK_SHEET, tankPose } from '../sprites/tank';

const Z = { wreck: 0.44, shadow: 0.42, hull: 0.46, turret: 0.47 };
const SHADOW_OPACITY = 0.5;

const shadows = pool(() => spriteMesh(TANK_SHEET, { shadow: true, opacity: SHADOW_OPACITY }));
const parts = pool(() => spriteMesh(TANK_SHEET));

export function drawTanks(view: CommanderView) {
  for (const v of view.vehicles ?? []) {
    const p = tankPose(v);
    for (const s of [p.shadow.hull, p.shadow.turret]) {
      const m = shadows.next();
      m.position.set(p.x, p.y, Z.shadow);
      m.rotation.z = s.rotation;
      m.scale.setScalar(p.size);
      m.frame.value = s.frame;
    }
    [p.hull, p.turret].forEach((s, i) => {
      const m = parts.next();
      m.position.set(p.x, p.y, v.wreck ? Z.wreck + i * 0.005 : i ? Z.turret : Z.hull);
      m.rotation.z = s.rotation;
      m.scale.setScalar(p.size);
      m.frame.value = s.frame;
    });
  }
  shadows.end();
  parts.end();
}

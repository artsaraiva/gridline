// Jets' bombs in the air (#110): each from the moment it leaves its jet to its mark, over its shadow on the ground. They ride
// on the jet's VehicleView as its `rounds`. sprites/bomb.ts says where; layers/impacts.ts draws the blast.
import type { CommanderView } from '../../sim/types';
import { pool } from '../renderer';
import { bombInFlight } from '../sprites/bomb';
import { spriteMesh } from '../sprites/sheet';
import { SHELL_SHADOW_FRAME, SHELL_SHEET } from '../sprites/shell';

// Under the jet that dropped it (0.74), over everything on the ground.
const Z = { shadow: 0.43, body: 0.73 };
const SHADOW_OPACITY = 0.5;

const bodies = pool(() => spriteMesh(SHELL_SHEET));
const shadows = pool(() => spriteMesh(SHELL_SHEET, { frame: SHELL_SHADOW_FRAME, shadow: true, opacity: SHADOW_OPACITY }));

export function drawBombs(view: CommanderView) {
  for (const v of view.vehicles ?? []) {
    if (v.kind !== 'jet') continue;
    for (const r of v.rounds ?? []) {
      const b = bombInFlight(r.from, r.to, r.flight);
      const s = shadows.next();
      s.position.set(b.ground.x, b.ground.y, Z.shadow);
      s.rotation.z = b.heading - Math.PI / 2;
      s.scale.setScalar(b.size);
      s.material.opacity = SHADOW_OPACITY * (0.4 + 0.6 * (1 - b.height));
      const m = bodies.next();
      m.position.set(b.x, b.y, Z.body);
      m.rotation.z = b.rotation;
      m.scale.setScalar(b.size);
      m.frame.value = b.frame;
    }
  }
  bodies.end();
  shadows.end();
}

// The Smoke Screen's discs as baked puffs (#138): sprites/smoke-screen.ts says what each disc shows; the view says where the
// discs are and how far each has bloomed or thinned. Both Sides' views carry them (the sky rule).
import type { CommanderView } from '../../sim/types';
import { pool } from '../renderer';
import { spriteMesh } from '../sprites/sheet';
import { SMOKE_PUFF_SHEET } from '../sprites/smoke-puff';
import { smokeLook } from '../sprites/smoke-screen';

const puffs = pool(() => spriteMesh(SMOKE_PUFF_SHEET));
const Z = 0.64; // over craters and impact plumes, under every symbol

export function drawSmokeScreens(view: CommanderView) {
  for (const e of view.effects ?? [])
    (e.smoke ?? []).forEach((d, i) => {
      for (const s of smokeLook(d, i)) {
        if (s.opacity <= 0) continue;
        const p = puffs.next();
        p.position.set(s.x, s.y, Z);
        // Mirror across the NE-SW diagonal (flip x, turn a quarter): keeps the baked north-east sun where it is.
        p.scale.set(s.flip ? -s.size : s.size, s.size, 1);
        p.rotation.z = s.flip ? -Math.PI / 2 : 0;
        p.material.opacity = s.opacity;
        p.frame.value = s.frame;
      }
    });
  puffs.end();
}

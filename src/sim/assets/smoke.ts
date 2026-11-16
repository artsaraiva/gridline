// Smoke Screen (#138): the first Screen. After a warning, shells land one after the other along a wall the Commander drew and
// each leaves a disc of smoke that blooms, holds and thins (../smoke.ts: ground sight through a disc fails both ways). It harms
// nobody, shows no Contacts and scores nothing. In the sky, so both Sides' views carry it.
import type { Mix } from '../state';
import { smokeDisc, smokeLife, STAGGER_SECONDS } from '../smoke';
import { flying, hashShells, type Shell } from './barrage';
import { assetRadio, hashLine, type EffectBase, type Kind, type Line, type Shells } from './core';

export interface SmokeEffect extends EffectBase, Shells, Line {
  asset: 'smoke';
}

export const smoke: Kind<SmokeEffect> = {
  name: 'Smoke Screen',
  called: 'Smoke inbound', // the spec's Voice Line
  sky: true,
  cooldownSeconds: (t) => t.smokeCooldownSeconds,
  seconds: (t) => t.smokeWarningSeconds + (t.smokeShells - 1) * STAGGER_SECONDS + smokeLife(t),
  radius: (t) => t.smokeWidthM / 2,
  line: (t) => ({ length: t.smokeLengthM, width: t.smokeWidthM }),

  start(m, base, { to }) {
    const t = m.tune;
    const n = t.smokeShells;
    const shells: Shell[] = [];
    for (let i = 0; i < n; i++) {
      const k = (i + 0.5) / n; // evenly along the wall, half a gap in from each end
      const land = m.tick + Math.round((t.smokeWarningSeconds + i * STAGGER_SECONDS) * t.hz);
      shells.push({ x: base.x + (to.x - base.x) * k, y: base.y + (to.y - base.y) * k, launch: land - Math.round(t.barrageFlightSeconds * t.hz), land, done: false });
    }
    return { ...base, asset: 'smoke', to, shells };
  },

  work(m, e, events) {
    for (const shell of e.shells) {
      if (shell.done || shell.land > m.tick) continue;
      shell.done = true;
      if (e.told) continue;
      e.told = true;
      assetRadio(m, e, 'Smoke on the deck', events);
    }
  },

  view(m, e) {
    const t = m.tune;
    const discs = e.shells.map((s) => ({ x: s.x, y: s.y, age: (m.tick - s.land) / t.hz, ...smokeDisc(t, m.tick - s.land) }));
    return { side: e.side, line: { to: e.to, width: t.smokeWidthM }, ...flying(m, e.shells), smoke: discs.filter((d) => d.r > 0) };
  },

  hash(e, mix: Mix) {
    hashLine(e, mix);
    hashShells(e.shells, mix);
  },
};

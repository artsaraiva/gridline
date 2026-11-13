// Smoke Screen (#138): the first Screen. After a warning, shells land one after the other along a wall the Commander drew and
// each leaves a disc of smoke that blooms, holds and thins (../smoke.ts: ground sight through a disc fails both ways). It harms
// nobody, shows no Contacts and scores nothing. In the sky, so both Sides' views carry it.
import type { Mix } from '../state';
import { smokeDisc, smokeLife } from '../smoke';
import { flying, hashShells } from './barrage';
import { assetRadio, type Kind } from './core';

/** The spec staggers the landings and gives no Tune key: each shell lands this long after the one before. */
export const STAGGER_SECONDS = 0.5;

export const smoke: Kind = {
  name: 'Smoke',
  sky: true,
  cooldownSeconds: (t) => t.smokeCooldownSeconds,
  seconds: (t) => t.smokeWarningSeconds + (t.smokeShells - 1) * STAGGER_SECONDS + smokeLife(t),
  radius: (t) => t.smokeWidthM / 2,
  line: (t) => ({ length: t.smokeLengthM, width: t.smokeWidthM }),

  start(m, e) {
    const t = m.tune;
    const n = t.smokeShells;
    e.shells = [];
    for (let i = 0; i < n; i++) {
      const k = (i + 0.5) / n; // evenly along the wall, half a gap in from each end
      const land = m.tick + Math.round((t.smokeWarningSeconds + i * STAGGER_SECONDS) * t.hz);
      e.shells.push({ x: e.x + (e.to!.x - e.x) * k, y: e.y + (e.to!.y - e.y) * k, launch: land - Math.round(t.barrageFlightSeconds * t.hz), land, done: false });
    }
  },

  work(m, e, events) {
    for (const shell of e.shells!) {
      if (shell.done || shell.land > m.tick) continue;
      shell.done = true;
      if (e.told) continue;
      e.told = true;
      assetRadio(m, e, 'Smoke on the deck', events);
    }
  },

  view(m, e) {
    const t = m.tune;
    const discs = e.shells!.map((s) => ({ x: s.x, y: s.y, age: (m.tick - s.land) / t.hz, ...smokeDisc(t, m.tick - s.land) }));
    return { side: e.side, line: { to: e.to!, width: t.smokeWidthM }, ...flying(m, e.shells!), smoke: discs.filter((d) => d.r > 0) };
  },

  hash: (e, mix: Mix) => hashShells(e.shells!, mix),
};

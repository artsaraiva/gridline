// #142 Rapid Deploy (was #145): for a while every Squad of the caller's Side, Elite or not (#153: it is Side-wide), Squad
// Respawns and Redeploys at `rapidMul` of the usual time, timers already running included (respawn.ts timerMul). It acts on no
// place: own Side only, nothing on the map, nothing the enemy sees, no Commander Score, and Squads never Request it.
import { assetRadio, type Kind } from './core';

export const rapid: Kind = {
  name: 'Rapid Deploy',
  called: 'Rapid deployment authorised',
  untargeted: true,
  cooldownSeconds: (t) => t.rapidCooldownSeconds,
  firstReadySeconds: (t) => t.rapidCooldownSeconds,
  seconds: (t) => t.rapidSeconds,
  radius: () => 0,
  work(m, e, events) {
    if (e.until === m.tick + 1) assetRadio(m, e, 'Rapid deployment over', events);
  },
};

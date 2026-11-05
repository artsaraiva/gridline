// Scan UAV: circles its spot and reveals every enemy near it, live, to every friendly Squad and the Commander.
import type { Kind } from './core';

export const scan: Kind = {
  name: 'Scan UAV',
  cooldownSeconds: (t) => t.scanCooldownSeconds,
  seconds: (t) => t.scanSeconds,
  radius: (t) => t.scanRadiusM,
  work: () => {},
};

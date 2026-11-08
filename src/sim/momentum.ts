// #123 momentum: the small step a vehicle takes each tick toward the speed and heading it wants. Pure, and no trig at run
// time (the Simulation's determinism rule): the turn step's sine and cosine come from short polynomials.

/** Speed (m/s) moved toward `want` by at most `accel` m/s² (speeding up) or `accel * brakeMul` (slowing), over one tick. */
export function approach(speed: number, want: number, accel: number, brakeMul: number, hz: number): number {
  const step = (want > speed ? accel : accel * brakeMul) / hz;
  return Math.abs(want - speed) <= step ? want : speed + Math.sign(want - speed) * step;
}

/** The highest speed (m/s) from which braking at `accel * brakeMul` still stops within `distM`. */
export const stopSpeed = (distM: number, accel: number, brakeMul: number) => Math.sqrt(2 * accel * brakeMul * distM);

/**
 * The unit heading (fx, fy) turned toward the unit way ahead (tx, ty) by at most `degPerS` over one tick: inside one step it
 * snaps to the way ahead (compared by dot product), else it rotates by the step, left or right as the cross product says.
 */
export function turnToward(fx: number, fy: number, tx: number, ty: number, degPerS: number, hz: number): { fx: number; fy: number } {
  const x = (degPerS * Math.PI) / 180 / hz;
  const x2 = x * x;
  const cos = 1 - x2 / 2 + (x2 * x2) / 24 - (x2 * x2 * x2) / 720; // far finer than any per-tick step needs
  const sin = x * (1 - x2 / 6 + (x2 * x2) / 120 - (x2 * x2 * x2) / 5040);
  if (fx * tx + fy * ty >= cos) return { fx: tx, fy: ty };
  const s = fx * ty - fy * tx >= 0 ? sin : -sin;
  const nx = fx * cos - fy * s;
  const ny = fx * s + fy * cos;
  const n = Math.sqrt(nx * nx + ny * ny);
  return { fx: nx / n, fy: ny / n };
}

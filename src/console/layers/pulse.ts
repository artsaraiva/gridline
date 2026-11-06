// Firing pulse (#70): chevrons rest calmer than the palette and brighten for a moment when their Soldier fires.
// Pure colour maths, DOM-free so it is testable; chevrons.ts applies it. Tune values judged by eye in the review scene.

/** How much of the palette colour's saturation a resting chevron keeps (0 grey, 1 the palette colour). */
export const REST_SATURATION = 0.5;
/** How bright a resting chevron is next to the palette colour (#54: dark enough that the pulse stands out). */
export const REST_BRIGHTNESS = 0.6;
/** A pulse lasts this long, then the chevron is back at rest. */
export const PULSE_MS = 400;
/** At its peak the pulse pushes the palette colour this far toward white, so the glow post-pass picks it up. */
export const PULSE_PEAK = 0.35;

/** Pulse strength at `age` ms since the shot: 1 at the shot, easing out to 0 by PULSE_MS. */
export const pulseAt = (age: number) => (age < 0 || age >= PULSE_MS ? 0 : (1 - age / PULSE_MS) ** 2);

const mix = (a: number, b: number, k: number) => a + (b - a) * k;

/** Chevron colour for a palette `color` at pulse strength `p`: desaturated and darkened at rest, over the palette colour at the peak. */
export function pulseColor(color: number, p: number): number {
  const [r, g, b] = [(color >> 16) & 255, (color >> 8) & 255, color & 255];
  const grey = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  let out = 0;
  for (const c of [r, g, b]) {
    const rest = mix(grey, c, REST_SATURATION) * REST_BRIGHTNESS;
    const peak = mix(c, 255, PULSE_PEAK);
    out = (out << 8) | Math.round(mix(rest, peak, p));
  }
  return out;
}

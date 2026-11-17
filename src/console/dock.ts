// Docking for the map's Asset tags: each tag wants to sit beside its mark, and where two would overlap the lower one drops
// under the other, so a cluster of Assets reads as a stack of tags, never a pile. A leader line then ties each tag back to
// its mark. Pure maths in screen px, DOM-free so it is testable; layers/effects.ts places the tags.

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const hits = (a: Box, b: Box, gap: number) => a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

/**
 * Where each of `tags` sits, in the order given: at the spot it asks for or, if that overlaps a tag placed before it or one
 * of the `blocked` boxes (the map Confirm button), straight down until it is `gap` px clear. Tags are placed top to bottom,
 * so a stack grows downward from its highest tag.
 */
export function dock(tags: Box[], blocked: Box[] = [], gap = 4): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = tags.map((t) => ({ x: t.x, y: t.y }));
  const taken = [...blocked];
  const order = tags.map((_, i) => i).sort((a, b) => tags[a]!.y - tags[b]!.y || a - b);
  for (const i of order) {
    const box = { ...tags[i]! };
    for (let tries = 0; tries <= taken.length; tries++) {
      const hit = taken.find((t) => hits(box, t, gap));
      if (!hit) break;
      box.y = hit.y + hit.h + gap;
    }
    taken.push(box);
    out[i] = { x: box.x, y: box.y };
  }
  return out;
}

/**
 * The leader from a mark at (`ax`, `ay`) to the middle of its tag's left edge, as an SVG path: out at 45 degrees until it is
 * level with the tag, then straight along to it. It starts `clear` px out from the mark, so it never crosses the mark itself.
 */
export function leader(ax: number, ay: number, tag: Box, clear = 8): string {
  const ty = tag.y + tag.h / 2;
  const run = Math.min(Math.abs(ty - ay), Math.max(0, tag.x - ax));
  const ex = ax + run;
  const d = Math.hypot(ex - ax, ty - ay);
  const r = (n: number) => Math.round(n * 10) / 10;
  if (d <= clear) return `M${r(Math.min(tag.x, ax + clear))} ${r(ty)}H${r(tag.x)}`; // level with the tag already: straight along
  const k = clear / d;
  return `M${r(ax + (ex - ax) * k)} ${r(ay + (ty - ay) * k)}L${r(ex)} ${r(ty)}H${r(tag.x)}`;
}

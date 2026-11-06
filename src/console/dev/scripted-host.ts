// The scripted SimHost behind the DEV review pages (#69, #84): a clock over a hand-written timeline instead of a
// Simulation. `sample` advances the clock while playing (and loops at the end); `takeEvents` hands over what the clock
// crossed since the last frame, nothing on a jump. The page's play/pause button, scrub, camera presets, the 1/2/space
// keys and the session wiring are the same on every page, so they live here too.
import type { SimHost } from '../../host/host';
import type { CommanderView, MapData, SimEvent, Vec2 } from '../../sim/types';
import { drawMap, fitView } from '../layers/map';
import { camera } from '../renderer';
import { session } from '../session';

export const $ = (id: string) => document.getElementById(id)!;

/** A timeline: pure `viewAt` and `eventsBetween` over `length` seconds, plus what the page wants told. */
export interface ScriptedTimeline {
  length: number;
  viewAt(t: number): CommanderView;
  eventsBetween(t0: number, t1: number): SimEvent[];
  /** When the clock jumps to `to` (a scrub, a chapter button, the loop back to 0). */
  onJump?(to: number): void;
}

/**
 * Builds the host over `timeline`, wires the page's `${prefix}-play`, `-scrub`, `-time`, `-overview` and `-close`
 * controls and the keys, draws `map`, hands the host to the session and starts the Console loop. Returns `jump`.
 */
export async function startScriptedHost(map: MapData, prefix: string, timeline: ScriptedTimeline, close: Vec2 & { zoom: number }) {
  const play = $(`${prefix}-play`) as HTMLButtonElement;
  const scrub = $(`${prefix}-scrub`) as HTMLInputElement;
  const time = $(`${prefix}-time`);

  let t = 0;
  let playing = true;
  let lastNow: number | null = null;
  let eventsFrom = 0;
  const jump = (to: number) => {
    t = eventsFrom = Math.max(0, Math.min(timeline.length, to));
    timeline.onJump?.(t);
  };
  const host: SimHost = {
    map,
    send() {},
    record: () => null,
    stop() {},
    sample(now) {
      if (playing && lastNow !== null) {
        t += (now - lastNow) / 1000;
        if (t >= timeline.length) jump(0); // loop
      }
      lastNow = now;
      scrub.value = String(t);
      time.textContent = `${t.toFixed(1)} s`;
      return timeline.viewAt(t);
    },
    takeEvents() {
      const events = timeline.eventsBetween(eventsFrom, t);
      eventsFrom = t;
      return events;
    },
  };

  const togglePlay = () => {
    playing = !playing;
    play.textContent = playing ? 'Pause' : 'Play';
  };
  play.onclick = togglePlay;
  scrub.oninput = () => jump(Number(scrub.value));

  const setOverview = () => fitView(map);
  const setClose = () => {
    camera.zoom = close.zoom;
    camera.position.set(close.x, close.y, 100);
    camera.updateProjectionMatrix();
  };
  $(`${prefix}-overview`).onclick = setOverview;
  $(`${prefix}-close`).onclick = setClose;
  window.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable]')) return;
    if (e.key === '1') setOverview();
    if (e.key === '2') setClose();
    if (e.key === ' ') {
      e.preventDefault();
      togglePlay();
    }
  });

  await drawMap(map);
  session.commanderSide = 'nato';
  session.enemySide = 'pact';
  session.host = host;
  setOverview();

  // Bring in the real Console render loop once the host and map are ready.
  await import('../main');
  return { jump };
}

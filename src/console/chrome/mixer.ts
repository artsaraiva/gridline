// #85: the mixer behind the speaker button in the radio head: Radio, Chatter and Combat levels and a master Mute, kept in
// localStorage; M toggles mute. The buses are separate (audio.ts), so a silenced Chatter bus never silences a radio line
// or a Callout: both sit on the radio bus. The kept mix (`parseMix`) is pure and tested; the panel's DOM is thin and not.
import { TUNING } from '../audio-mix';

const MIX_KEY = 'gridline.mix';
const BUSES = ['radio', 'chatter', 'combat'] as const;
export interface Mix {
  radio: number;
  chatter: number;
  combat: number;
  mute: boolean;
}
/** The spec's defaults, levels in percent. */
export const DEFAULT_MIX: Mix = { radio: 80, chatter: 40, combat: 60, mute: false };

/** The kept mix from its JSON: a missing or bad field falls back to its default, a level is clamped to 0..100 and rounded. */
export function parseMix(json: string | null): Mix {
  let kept: unknown = null;
  try {
    kept = json === null ? null : JSON.parse(json);
  } catch {}
  const r = (typeof kept === 'object' && kept !== null ? kept : {}) as Partial<Record<keyof Mix, unknown>>;
  const level = (k: (typeof BUSES)[number]) => {
    const v = r[k];
    return typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.min(100, Math.max(0, v))) : DEFAULT_MIX[k];
  };
  return { radio: level('radio'), chatter: level('chatter'), combat: level('combat'), mute: typeof r.mute === 'boolean' ? r.mute : DEFAULT_MIX.mute };
}

/**
 * Builds the speaker button (`#mixer-toggle`, before the fold button in the radio head) and fills the `#mixer` panel:
 * the kept mix goes into TUNING now, the sliders, Mute and the M key change it, and every change is kept. `apply`
 * pushes TUNING to the buses (audio.ts `applyMix`).
 */
export function bindMixer(apply: () => void) {
  const panel = document.getElementById('mixer')!;
  const toggle = document.createElement('button');
  toggle.id = 'mixer-toggle';
  toggle.type = 'button';
  toggle.title = 'Mixer · M mutes';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', 'mixer');
  toggle.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"><path d="M4 9.5v5h3.5l4.5 4v-13l-4.5 4z"/><path d="M15.5 9.2a4 4 0 0 1 0 5.6M18.2 6.5a7.8 7.8 0 0 1 0 11"/></svg>';
  document.getElementById('radio-fold')!.before(toggle);
  let kept: string | null = null;
  try {
    kept = localStorage.getItem(MIX_KEY);
  } catch {}
  const mix = parseMix(kept);

  panel.innerHTML = BUSES.map((k) => `<label><span>${k[0]!.toUpperCase()}${k.slice(1)}</span><input type="range" name="${k}" min="0" max="100" step="1" /><output></output></label>`).join('') + '<button type="button" aria-pressed="false">Mute</button>';
  const sliders = BUSES.map((k) => [k, panel.querySelector<HTMLInputElement>(`input[name=${k}]`)!] as const);
  const mute = panel.querySelector('button')!;

  const push = () => {
    for (const k of BUSES) TUNING.bus[k] = mix[k] / 100;
    TUNING.mute = mix.mute;
    apply();
  };
  const show = () => {
    for (const [k, input] of sliders) {
      input.value = String(mix[k]);
      input.nextElementSibling!.textContent = `${mix[k]}%`;
    }
    mute.textContent = mix.mute ? 'Unmute' : 'Mute';
    mute.setAttribute('aria-pressed', String(mix.mute));
    toggle.classList.toggle('muted', mix.mute);
  };
  const commit = () => {
    push();
    try {
      localStorage.setItem(MIX_KEY, JSON.stringify(mix));
    } catch {}
    show();
  };

  for (const [k, input] of sliders) {
    input.oninput = () => {
      mix[k] = Number(input.value);
      commit();
    };
  }
  mute.onclick = () => {
    mix.mute = !mix.mute;
    commit();
  };
  toggle.onclick = () => {
    panel.hidden = !panel.hidden;
    toggle.setAttribute('aria-expanded', String(!panel.hidden));
  };
  document.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() !== 'm' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable]')) return;
    mute.click();
  });
  push();
  show();
}

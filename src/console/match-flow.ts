// Match flow: the setup screen starts a match, the end screen shows how it went and leads back to setup.
import { startSimHost } from '../host/host';
import type { MatchSetup } from '../host/protocol';
import { enemyOf, type CommanderView } from '../sim/types';
import { drawMap } from './layers/map';
import { resetChevrons } from './layers/chevrons';
import { resetMarkers } from './layers/markers';
import { resetPoints } from './layers/points';
import { layer } from './renderer';
import { session } from './session';
import { endSummary } from './summary';

const MIN_SQUADS = 3;
const MAX_SQUADS = 8;

const setupForm = document.getElementById('setup') as HTMLFormElement;
const endScreen = document.getElementById('end')!;
const squadSelect = setupForm.elements.namedItem('squads') as HTMLSelectElement;
for (let n = MIN_SQUADS; n <= MAX_SQUADS; n++) squadSelect.add(new Option(String(n), String(n)));

// URL params preset the setup screen; `seed` fixes the first match's seed (seed 4 shows a decisive capture on the test field).
const params = new URLSearchParams(location.search);
let urlSeed = params.get('seed');
(setupForm.elements.namedItem('side') as RadioNodeList).value = params.get('side') === 'pact' ? 'pact' : 'nato';
squadSelect.value = String(Math.min(MAX_SQUADS, Math.max(MIN_SQUADS, Number(params.get('squads')) || MIN_SQUADS)));

async function startMatch(setup: MatchSetup) {
  session.host?.stop();
  session.host = null;
  layer.clear();
  resetPoints();
  resetChevrons();
  resetMarkers();
  session.commanderSide = setup.commanderSide;
  session.enemySide = enemyOf(setup.commanderSide);
  session.seed = setup.seed;
  session.ended = false;
  session.host = await startSimHost({ kind: 'start', ...setup });
  drawMap(session.host.map);
}

setupForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const data = new FormData(setupForm);
  const matchSeed = Number.isFinite(Number(urlSeed ?? NaN)) ? Number(urlSeed) >>> 0 : (Math.random() * 2 ** 32) >>> 0;
  urlSeed = null;
  setupForm.hidden = true;
  void startMatch({
    commanderSide: data.get('side') === 'pact' ? 'pact' : 'nato',
    squadsPerSide: Number(data.get('squads')),
    seed: matchSeed,
  });
});

function showEnd(summary: ReturnType<typeof endSummary>) {
  const set = (id: string, text: string) => (document.getElementById(id)!.textContent = text);
  set('end-result', summary.result);
  set('end-reason', summary.reason);
  set('end-friendly', `${summary.friendly.faction} ${summary.friendly.tickets}`);
  set('end-enemy', `${summary.enemy.faction} ${summary.enemy.tickets}`);
  set('end-time', summary.time);
  set('end-seed', String(session.seed));
  set('end-copy', 'Copy match record');
  endScreen.hidden = false;
}

/** Shows the end screen once the Match is over. The record arrives with the final view, so it waits for both. */
export function checkEnd(view: CommanderView) {
  if (!view.result || !session.host?.record() || session.ended) return;
  session.ended = true;
  showEnd(endSummary(view));
}

document.getElementById('end-copy')!.addEventListener('click', async (e) => {
  const button = e.currentTarget as HTMLButtonElement;
  try {
    await navigator.clipboard.writeText(JSON.stringify(session.host!.record(), null, 2));
    button.textContent = 'Copied';
  } catch {
    button.textContent = 'Copy failed';
  }
});

document.getElementById('end-new')!.addEventListener('click', () => {
  session.host?.stop();
  session.host = null;
  endScreen.hidden = true;
  setupForm.hidden = false;
});

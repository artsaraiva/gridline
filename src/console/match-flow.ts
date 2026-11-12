// Match flow: the setup screen starts a match, the end screen shows how it went and leads back to setup.
import { startSimHost } from '../host/host';
import type { MapId, MatchSetup } from '../host/protocol';
import { enemyOf, type CommanderView } from '../sim/types';
import { silence } from './audio';
import { drawMap } from './layers/map';
import { resetChevrons } from './layers/chevrons';
import { resetContacts } from './layers/contacts';
import { resetRadioLog } from './chrome/radio-log';
import { resetSquads } from './chrome/squads';
import { resetImpacts } from './layers/impacts';
import { resetOrders } from './layers/orders';
import { resetMarkers } from './layers/markers';
import { resetPoints } from './layers/points';
import { resetTracers } from './layers/tracers';
import { layer } from './renderer';
import { session } from './session';
import { disarm, select } from './targeting';
import { endSummary } from './summary';

const MIN_SQUADS = 3;
const DEFAULT_SQUADS = 4;
const MAX_SQUADS = 8;
/** #150: 128 v 128 on Auental, offered on top of 3 to 8; past 8, only the first 8 Squads are Elite (#153). */
const AUENTAL_SQUADS = [16, 24, 32];

const setupForm = document.getElementById('setup') as HTMLFormElement;
const loading = document.getElementById('loading')!;
const endScreen = document.getElementById('end')!;
const squadSelect = setupForm.elements.namedItem('squads') as HTMLSelectElement;
const mapSelect = setupForm.elements.namedItem('map') as HTMLSelectElement;
/** The Squad counts the picked map offers, keeping `want` if it is one, else the nearest of 3 to 8. */
function fillSquads(want: number) {
  const counts = Array.from({ length: MAX_SQUADS - MIN_SQUADS + 1 }, (_, i) => MIN_SQUADS + i).concat(mapSelect.value === 'auental' ? AUENTAL_SQUADS : []);
  squadSelect.replaceChildren(...counts.map((n) => new Option(String(n))));
  squadSelect.value = String(counts.includes(want) ? want : Math.min(MAX_SQUADS, Math.max(MIN_SQUADS, want)));
}
mapSelect.addEventListener('change', () => fillSquads(Number(squadSelect.value)));

// URL params preset the setup screen; `seed` fixes the first match's seed (seed 4 shows a decisive capture on the test field).
// `map=auental` presets the Map select; `map=test` plays the hand-written test field whatever the select says.
const params = new URLSearchParams(location.search);
let urlSeed = params.get('seed');
(setupForm.elements.namedItem('side') as RadioNodeList).value = params.get('side') === 'pact' ? 'pact' : 'nato';
if (params.get('map') === 'auental') mapSelect.value = 'auental';
fillSquads(Number(params.get('squads')) || DEFAULT_SQUADS);

async function startMatch(setup: MatchSetup, map: MapId) {
  session.host?.stop();
  session.host = null;
  layer.clear();
  resetPoints();
  resetChevrons();
  resetContacts();
  resetMarkers();
  resetTracers();
  resetImpacts();
  resetOrders();
  resetSquads();
  resetRadioLog();
  silence();
  disarm();
  select(null);
  session.commanderSide = setup.commanderSide;
  session.enemySide = enemyOf(setup.commanderSide);
  session.seed = setup.seed;
  session.ended = false;
  // `?free=1` keeps the Asset cooldowns at zero and #107 `?tanks=3` gives each Side three tanks, for a by-eye check; the
  // worker honours them only under `import.meta.env.DEV`.
  const tanks = Math.round(Number(params.get('tanks'))) || undefined;
  // #150: the worker loads the bake and warms its flow fields before the match starts (seconds on Auental), then drawMap loads the
  // images; the waiting screen stays up until both are done
  loading.hidden = false;
  const host = await startSimHost({ kind: 'start', map: params.get('map') === 'test' ? 'test' : map, dev: { freeAssets: params.has('free'), tanks }, ...setup });
  await drawMap(host.map); // the ticking sim waits in the worker's queue while the bake loads
  loading.hidden = true;
  session.host = host;
}

setupForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const data = new FormData(setupForm);
  const matchSeed = Number.isFinite(Number(urlSeed ?? NaN)) ? Number(urlSeed) >>> 0 : (Math.random() * 2 ** 32) >>> 0;
  urlSeed = null;
  setupForm.hidden = true;
  void startMatch(
    { commanderSide: data.get('side') === 'pact' ? 'pact' : 'nato', squadsPerSide: Number(data.get('squads')), seed: matchSeed },
    data.get('map') === 'auental' ? 'auental' : 'kaltenbach',
  );
});

function showEnd(summary: ReturnType<typeof endSummary>) {
  const set = (id: string, text: string) => (document.getElementById(id)!.textContent = text);
  set('end-result', summary.result);
  set('end-reason', summary.reason);
  set('end-friendly', `${summary.friendly.faction} ${summary.friendly.tickets}`);
  set('end-enemy', `${summary.enemy.faction} ${summary.enemy.tickets}`);
  set('end-time', summary.time);
  set('end-seed', String(session.seed));
  const score = document.getElementById('end-score')!;
  score.innerHTML = `<dt>Commander Score</dt><dd>${summary.score.total}</dd>` + summary.score.rows.map((r) => `<dt class="sub">${r.label}</dt><dd class="sub">${r.points}</dd>`).join('');
  set('end-copy', 'Copy match record');
  endScreen.hidden = false;
}

/** Shows the end screen once the Match is over. The record arrives with the final view, so it waits for both. */
export function checkEnd(view: CommanderView) {
  if (!view.result || !session.host?.record() || session.ended) return;
  session.ended = true;
  silence();
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

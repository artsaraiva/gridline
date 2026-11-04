// Sim host, worker side: runs the Simulation on a fixed 20 Hz tick, stamps Commands, keeps the seed and Command log.
import { commanderView, createMatch, step, type Command, type Match } from '../sim/index';
import { DEFAULT_TUNE } from '../sim/tune';
import { TEST_FIELD } from '../maps/test-field';
import type { FromHost, ToHost } from './protocol';

let match: Match;
let side: Extract<ToHost, { kind: 'start' }>['commanderSide'];
let pending: Command[] = [];
const record = { seed: 0, log: [] as Command[] }; // ponytail: in memory only; export comes with the after-action replay

const post = (msg: FromHost) => postMessage(msg);

function tick() {
  step(match, pending);
  pending = [];
  post({ kind: 'view', view: commanderView(match, side) });
}

function loop(next: number) {
  const ms = 1000 / match.tune.hz;
  const now = performance.now();
  let steps = 0;
  while (now >= next && !match.result && steps < 5) {
    tick();
    next += ms;
    steps++;
  }
  if (steps === 5) next = now; // fell behind (tab hidden, GC): drop the time instead of spiralling
  if (!match.result) setTimeout(() => loop(next), Math.max(0, next - performance.now()));
}

onmessage = (e: MessageEvent<ToHost>) => {
  const msg = e.data;
  if (msg.kind === 'start') {
    side = msg.commanderSide;
    record.seed = msg.seed;
    match = createMatch({ seed: msg.seed, map: TEST_FIELD, tune: DEFAULT_TUNE, squadsPerSide: msg.squadsPerSide, commanderSide: side });
    post({ kind: 'started', map: TEST_FIELD, hz: DEFAULT_TUNE.hz, view: commanderView(match, side) });
    loop(performance.now());
  } else {
    const cmd = { ...msg.command, tick: match.tick } as Command;
    pending.push(cmd);
    record.log.push(cmd);
  }
};

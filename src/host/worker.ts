// Sim host, worker side: runs the Simulation on a fixed 20 Hz tick, stamps Commands, keeps the match record (seed, setup, Command log) and hands it over when the match ends.
import { commanderView, createMatch, step, type Command, type Match } from '../sim/index';
import { DEFAULT_TUNE } from '../sim/tune';
import { TEST_FIELD } from '../maps/test-field';
import type { FromHost, MatchRecord, ToHost } from './protocol';

let match: Match;
let pending: Command[] = [];
let record: MatchRecord;

const post = (msg: FromHost) => postMessage(msg);

function tick() {
  const events = step(match, pending);
  pending = [];
  post({ kind: 'view', view: commanderView(match, record.commanderSide), events, ...(match.result && { record }) });
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
    const { kind: _, ...setup } = msg;
    record = { ...setup, map: TEST_FIELD.name, log: [] };
    match = createMatch({ ...setup, map: TEST_FIELD, tune: DEFAULT_TUNE });
    post({ kind: 'started', map: TEST_FIELD, hz: DEFAULT_TUNE.hz, view: commanderView(match, setup.commanderSide) });
    loop(performance.now());
  } else if (!match.result) {
    const cmd = { ...msg.command, tick: match.tick } as Command;
    pending.push(cmd);
    record.log.push(cmd);
  }
};

// Sim host, worker side: runs the Simulation on a fixed 20 Hz tick, stamps Commands, keeps the match record (seed, setup, Command log) and hands it over when the match ends.
import { commanderEvents, commanderView, createMatch, step, warmFlows, type Command, type Match } from '../sim/index';
import { DEFAULT_TUNE } from '../sim/tune';
import { loadBakedMap } from '../maps/load';
import { TEST_FIELD } from '../maps/test-field';
import type { FromHost, MatchRecord, ToHost } from './protocol';

let match: Match;
let pending: Command[] = [];
let record: MatchRecord;

const post = (msg: FromHost) => postMessage(msg);

function tick() {
  const events = step(match, pending);
  pending = [];
  const side = record.commanderSide;
  post({ kind: 'view', view: commanderView(match, side), events: commanderEvents(match, side, events), ...(match.result && { record }) });
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

onmessage = async (e: MessageEvent<ToHost>) => {
  const msg = e.data;
  if (msg.kind === 'start') {
    const { kind: _, map: id, ...setup } = msg;
    const map = id === 'test' ? TEST_FIELD : await loadBakedMap(`${import.meta.env.BASE_URL}maps/kaltenbach`, DEFAULT_TUNE.cellM);
    record = { ...setup, map: map.name, log: [] };
    match = createMatch({ ...setup, map, tune: DEFAULT_TUNE });
    warmFlows(match); // ~0.5 s once, so no tick of the match pays ~15 ms for a flow field
    post({ kind: 'started', map, hz: DEFAULT_TUNE.hz, view: commanderView(match, setup.commanderSide) });
    loop(performance.now());
  } else if (match && !match.result) {
    const cmd = { ...msg.command, tick: match.tick, side: record.commanderSide } as Command;
    pending.push(cmd);
    record.log.push(cmd);
  }
};

// Sim host, main-thread side: starts the worker and interpolates Commander views between ticks for drawing.
import type { SoldierView, CommanderView, MapData, SimEvent } from '../sim/types';
import type { FromHost, MatchRecord, ToHost, UnstampedCommand } from './protocol';

export interface SimHost {
  map: MapData;
  /** The latest view with Soldier positions interpolated to `now` (one tick behind the sim). */
  sample(now: number): CommanderView;
  send(command: UnstampedCommand): void;
  /** Events from every tick since the last call. */
  takeEvents(): SimEvent[];
  /** The match's seed, setup and full Command log; null until the match ends. */
  record(): MatchRecord | null;
  /** Ends the worker; the host is dead afterwards. */
  stop(): void;
}

export function startSimHost(opts: Extract<ToHost, { kind: 'start' }>): Promise<SimHost> {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  const post = (msg: ToHost) => worker.postMessage(msg);
  return new Promise((resolve) => {
    let prev: CommanderView;
    let curr: CommanderView;
    let currAt = 0;
    let tickMs = 50;
    let events: SimEvent[] = [];
    let record: MatchRecord | null = null;
    worker.onmessage = (e: MessageEvent<FromHost>) => {
      const msg = e.data;
      prev = curr ?? msg.view;
      curr = msg.view;
      currAt = performance.now();
      if (msg.kind === 'view') {
        events.push(...msg.events);
        record = msg.record ?? record;
      }
      if (msg.kind !== 'started') return;
      tickMs = 1000 / msg.hz;
      resolve({
        map: msg.map,
        send: (command) => post({ kind: 'command', command }),
        takeEvents: () => events.splice(0),
        record: () => record,
        stop: () => worker.terminate(),
        sample(now) {
          const a = Math.min(1, Math.max(0, (now - currAt) / tickMs));
          const lerp = <T extends SoldierView>(from: T[], to: T[]) => {
            const before = new Map(from.map((c) => [c.id, c]));
            return to.map((c) => {
              const b = before.get(c.id) ?? c;
              return { ...c, x: b.x + (c.x - b.x) * a, y: b.y + (c.y - b.y) * a };
            });
          };
          return { ...curr, friendlies: lerp(prev.friendlies, curr.friendlies), contacts: lerp(prev.contacts, curr.contacts) };
        },
      });
    };
    post(opts);
  });
}

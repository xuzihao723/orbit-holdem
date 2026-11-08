import { DatabaseSync } from 'node:sqlite';
import { createDeck, type CardId } from '@orbit/poker-core';

import { test as base, expect } from '@playwright/test';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import {
  createApplicationRuntime,
  type ApplicationRuntime,
} from '../../apps/server/dist/application-runtime.js';
import { createPokerServer } from '../../apps/server/dist/create-server.js';
import type { AuthenticatedCommand } from '../../apps/server/dist/transport/types.js';
import { FakeClock } from '../helpers/fake-clock.js';
interface Faults {
  scenario: 'random' | 'sidepots' | 'tie' | 'standard' | 'short';
  commands: { event: string; commandId: string }[];
  dropEvent: string | null;
  dropNth: number;
  seen: number;
  release: (() => void) | null;
}
export const test = base.extend<
  {},
  { network: ApplicationRuntime; clock: FakeClock; faults: Faults }
>({
  clock: [
    async ({}, use) => {
      await use(new FakeClock());
    },
    { scope: 'worker' },
  ],
  faults: [
    async ({}, use) => {
      const f: Faults = {
        scenario: 'random',
        commands: [],
        dropEvent: null,
        dropNth: 1,
        seen: 0,
        release: null,
      };
      try {
        await use(f);
      } finally {
        f.release?.();
      }
    },
    { scope: 'worker' },
  ],
  network: [
    async ({ clock, faults }, use) => {
      const dir = mkdtempSync(join(tmpdir(), 'orbit-table-browser-')),
        app = createApplicationRuntime({
          databasePath: join(dir, 'network.sqlite'),
          serverClock: clock,
          randomInt: () => (faults.scenario === 'sidepots' ? 2 : 0),
          handDeck: () => {
            if (faults.scenario === 'sidepots') {
              const cases = JSON.parse(readFileSync('tests/fixtures/scenarios.json', 'utf8')) as {
                id: string;
                given: { settlementHoleCards: Record<string, CardId[]>; settlementBoard: CardId[] };
              }[];
              const f = cases.find((c) => c.id === 'LIFE04')!.given,
                holes = ['A', 'B', 'C'].map((id) => f.settlementHoleCards[id]!);
              const prefix: CardId[] = [
                holes[0]![0]!,
                holes[1]![0]!,
                holes[2]![0]!,
                holes[0]![1]!,
                holes[1]![1]!,
                holes[2]![1]!,
                '2S',
                ...f.settlementBoard.slice(0, 3),
                '3S',
                f.settlementBoard[3]!,
                '4S',
                f.settlementBoard[4]!,
              ];
              return [...prefix, ...createDeck().filter((c) => !prefix.includes(c))];
            }
            const prefix: CardId[] =
              faults.scenario === 'tie'
                ? ['2H', '3H', '4H', '5H', '2C', 'AS', 'KS', 'QS', '3C', 'JS', '4C', '10S']
                : faults.scenario === 'standard'
                  ? ['KH', 'AH', 'KD', 'AD', '2S', '2H', '7D', '9C', '3S', 'JS', '4S', '3C']
                  : [];
            return [...prefix, ...createDeck().filter((c) => !prefix.includes(c))];
          },
        });
      clock.flush = async () => {
        await app.rooms.queue.idle();
        await new Promise<void>((r) => setImmediate(r));
      };
      const high = { connection: 1000, session: 1000, ip: 10000, windowMs: 1000 };
      const server = createPokerServer({
        port: 3001,
        webOrigin: 'http://127.0.0.1:4173',
        application: app,
        transport: {
          now: clock.now,
          limits: {
            admission: high,
            management: high,
            action: high,
            global: high,
            identity: { ...high, session: 0 },
          },
        },
        executor: {
          execute: async (c: AuthenticatedCommand) => {
            if (
              c.event === 'room:start' &&
              (faults.scenario === 'sidepots' || faults.scenario === 'short')
            ) {
              const state = app.rooms.store.get(c.payload.roomId)!;
              const stacks = faults.scenario === 'sidepots' ? [100, 250, 400] : [15, 2000];
              const raw = new DatabaseSync(join(dir, 'network.sqlite'));
              try {
                const participants = state.participants.map((p) => ({
                  ...p,
                  stack: stacks[p.seatId]!,
                }));
                for (const p of participants)
                  raw
                    .prepare('UPDATE participants SET stack=? WHERE participant_id=?')
                    .run(p.stack, p.participantId);
                app.rooms.store.replace({ ...state, participants });
              } finally {
                raw.close();
              }
            }
            faults.commands.push({ event: c.event, commandId: c.payload.commandId });
            const ack = await app.rooms.execute(c);
            if (c.event === faults.dropEvent && ++faults.seen === faults.dropNth) {
              faults.dropEvent = null;
              await new Promise<void>((r) => {
                faults.release = r;
              });
            }
            return ack;
          },
          afterAck: (c, ack) => app.rooms.afterAck(c, ack),
        },
      });
      try {
        await server.listen();
        await use(app);
      } finally {
        faults.release?.();
        await server.close();
        await app.close();
        assert.equal(dirname(resolve(dir)), resolve(tmpdir()));
        assert.ok(basename(dir).startsWith('orbit-table-browser-'));
        rmSync(dir, { recursive: true });
      }
    },
    { scope: 'worker', auto: true },
  ],
});
export { expect };

test.afterEach(({ faults }) => {
  faults.scenario = 'random';
});

import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { lifecycleContext } from '../helpers/lifecycle-context.js';
import { request, resumeRequest } from '../helpers/session-context.js';
import { assertHandInvariants } from '../../packages/poker-core/src/index.js';
it('finishes ten consecutive real hands for each of two, three and four humans with native ledger evidence', async () => {
  const runs: unknown[] = [];
  let passed = false;
  try {
    for (const players of [2, 3, 4] as const) {
      const c = await lifecycleContext({ players });
      try {
        for (let i = 0; i < 10; i++) {
          await c.start();
          const id = c.room().hand!.handId;
          if (i === 3) {
            const h = c.humans[0]!,
              next = await c.guest('Replacement');
            const ack = await request(
              next.socket,
              'session:resume',
              resumeRequest(h.resumeToken, { roomId: c.roomId, lastSeenHandId: id }),
            );
            expect(ack).toMatchObject({ ok: true, outcome: 'seatRestored' });
            h.socket = next.socket;
          }
          let count = 0;
          while (c.room().hand!.phase !== 'settled') {
            if (++count > 4) throw Error('MATRIX_ACTION_LIMIT');
            const h = c.room().hand!,
              actor = c.humans[h.betting!.actorSeatId!]!,
              payload = {
                commandId: randomUUID(),
                roomId: c.roomId,
                handId: id,
                turnId: h.turnId!,
                expectedVersion: h.handVersion,
                action: { type: 'fold' as const },
              };
            const ack = await c.command(actor.socket, 'game:action', payload);
            expect(ack).toMatchObject({ ok: true });
            if (count === 1 && i === 0)
              expect(await c.command(actor.socket, 'game:action', payload)).toMatchObject({
                ok: true,
                duplicate: true,
              });
          }
          const h = c.room().hand!,
            events = c.storage.raw
              .prepare('SELECT sequence,kind FROM hand_events WHERE hand_id=? ORDER BY sequence')
              .all(id),
            saved = c.app.database.hands.readHand(id)!;
          assertHandInvariants(h);
          expect(h.players.reduce((n, p) => n + p.stack, 0)).toBe(players * 2000);
          expect(saved.result!.finalStacks.map((p) => p.stack)).toEqual(
            h.players.map((p) => p.stack),
          );
          expect(events.map((e) => e.sequence)).toEqual(
            Array.from({ length: events.length }, (_, j) => j + 1),
          );
          expect(events.filter((e) => e.kind === 'handSettled')).toHaveLength(1);
          expect(c.room().participants.every((p) => !p.ready)).toBe(true);
          expect(c.room().row.status).toBe('betweenHands');
          runs.push({
            players,
            handNumber: i + 1,
            handVersion: h.handVersion,
            eventCount: events.length,
            chips: players * 2000,
            settlementCount: h.settlementCount,
            duplicateTested: i === 0,
            resumeTested: i === 3,
          });
        }
        expect(
          c.storage.db.repositories.listLedger(c.roomId).filter((e) => e.type === 'seat_grant'),
        ).toHaveLength(players);
      } finally {
        await c.close();
      }
    }
    passed = true;
  } finally {
    writeFileSync(
      `docs/verification/${process.env.ORBIT_VERIFY_STAGE ?? 'scratch'}-human-matrix.json`,
      JSON.stringify(
        {
          date: '2026-11-01',
          passed,
          realGuests: true,
          source: 'real Socket.IO room/ready/start/action',
          runs,
          credentialsIncluded: false,
        },
        null,
        2,
      ) + '\n',
    );
  }
}, 30000);

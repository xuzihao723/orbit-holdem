import { expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { lifecycleContext } from '../helpers/lifecycle-context.js';
import { roomStartModes } from '../helpers/room-scenarios.js';
import { getHandLegalActions, assertHandInvariants } from '../../packages/poker-core/src/index.js';
import { waitUntil } from '../helpers/reconnect-context.js';
it('ROOM01-09 and original difficulty variants finish through real scheduling without auto-starting another hand', async () => {
  const modes: unknown[] = [];
  let passed = false;
  try {
    for (const f of roomStartModes()) {
      const players = f.members.filter((p) => p.kind === 'human').length as 1 | 2 | 3 | 4,
        bots = f.members.length - players,
        c = await lifecycleContext({
          players,
          bots,
          capacity: f.capacity,
          difficulty: f.difficulty === 'standard' ? 'standard' : 'basic',
          botOptions: { delayRandom: { next: () => 0 }, policyRandom: { next: () => 0.99 } },
        });
      try {
        expect(c.room().participants.map((p) => p.stack)).toEqual(f.members.map((p) => p.stack));
        expect(c.room().row.capacity - c.room().participants.length).toBe(f.empty);
        const finish = async () => {
          let n = 0;
          while (c.room().hand!.phase !== 'settled') {
            if (++n > 200) throw Error('BOT_MODE_ACTION_LIMIT:' + f.name);
            const h = c.room().hand!,
              actor = h.betting!.actorSeatId!,
              member = c.room().participants.find((p) => p.seatId === actor)!;
            if (member.botId) {
              if (member.botDifficulty === 'standard' && h.phase !== 'preflop')
                await waitUntil(() => c.app.workerPool.stats.pendingJobs === 0);
              await c.clock.advanceTo(c.clock.now() + 500);
            } else {
              const legal = getHandLegalActions(h, actor),
                who = c.humans.find((p) => p.sessionId === member.sessionId)!,
                type = legal.allowed.includes('check')
                  ? 'check'
                  : legal.allowed.includes('call')
                    ? 'call'
                    : 'allIn';
              expect(
                await c.command(who.socket, 'game:action', {
                  commandId: crypto.randomUUID(),
                  roomId: c.roomId,
                  handId: h.handId,
                  turnId: h.turnId!,
                  expectedVersion: h.handVersion,
                  action: { type },
                }),
              ).toMatchObject({ ok: true });
            }
          }
          assertHandInvariants(c.room().hand!);
          expect(c.room().hand!.settlementCount).toBe(1);
          expect(c.room().hand!.players.reduce((n, p) => n + p.stack, 0)).toBe(f.count * 2000);
          return n;
        };
        await c.start();
        expect(c.room().hand!.initialChipTotal).toBe(f.count * 2000);
        expect(c.room().hand!.positions.smallBlindSeatId).not.toBe(
          c.room().hand!.positions.bigBlindSeatId,
        );
        const blindAmounts = c.storage.raw
          .prepare("SELECT payload_json FROM hand_events WHERE hand_id=? AND kind='blindPosted'")
          .all(c.room().hand!.handId)
          .map((v) => (JSON.parse(String(v.payload_json)) as { amount: number }).amount)
          .sort((a, b) => a - b);
        expect(blindAmounts).toEqual([10, 20]);
        const actions = await finish(),
          first = c.room().hand!.handId;
        await c.clock.advanceTo(c.clock.now() + 60000);
        expect(c.room().hand!.handId).toBe(first);
        expect(c.room().participants.every((p) => !p.ready)).toBe(true);
        let second = false;
        if (players === 1) {
          await c.start();
          await finish();
          second = true;
        }
        if (f.difficulty === 'standard') {
          expect(c.app.bots.diagnostics.standardEngineUnavailable).toBe(0);
          expect(c.app.bots.diagnostics.workerJobs).toBeGreaterThan(0);
        }
        expect(
          c.storage.db.repositories.listLedger(c.roomId).filter((e) => e.type === 'seat_grant'),
        ).toHaveLength(f.count);
        modes.push({
          name: f.name,
          players,
          bots,
          capacity: f.capacity,
          participantCount: f.count,
          actions,
          secondHand: second,
          diagnostics: c.app.bots.diagnostics,
          finalChips: f.count * 2000,
          standardEngineLive: true,
        });
      } finally {
        await c.close();
      }
    }
    passed = true;
  } finally {
    writeFileSync(
      `docs/verification/${process.env.ORBIT_VERIFY_STAGE ?? 'scratch'}-modes.json`,
      JSON.stringify(
        {
          date: '2026-11-01',
          passed,
          fixtureSource: 'ROOM01-09 including original difficulty variants',
          modes,
          credentialsIncluded: false,
        },
        null,
        2,
      ) + '\n',
    );
  }
}, 30000);

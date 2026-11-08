import { expect, it } from 'vitest';
import { createHand } from '../../packages/poker-core/src/state.js';
import { handInput } from '../helpers/hand-scenarios.js';
import { stepHand, passiveHand } from '../helpers/hand-replay.js';
it('sequences all real hand events with private holes, internal burns and atomic versions', () => {
  const r = passiveHand(handInput('S02'));
  expect(r.events.map((e) => e.sequence)).toEqual(r.events.map((_, i) => i + 1));
  expect(r.state.eventSequence).toBe(r.events.length);
  for (const e of r.events) {
    expect(Object.isFrozen(e)).toBe(true);
    expect(e.handVersion).toBeGreaterThanOrEqual(1);
    expect(e.handVersion).toBeLessThanOrEqual(r.state.handVersion);
    if (e.kind === 'holeDealt') expect(e.visibility).toBe('owner');
    if (e.kind === 'cardBurned') expect(e.visibility).toBe('internal');
  }
  expect(r.events.filter((e) => e.kind === 'boardDealt')).toHaveLength(3);
  expect(r.events.filter((e) => e.kind === 'handSettled')).toHaveLength(1);
  expect(JSON.stringify(r.events)).not.toContain('"deck"');
  expect(JSON.stringify(r.state.result)).not.toContain('burnCards');
});
it('reveals nobody after a real fold, and never reveals an earlier folded opponent at showdown', () => {
  const a = createHand(handInput('S02'));
  const end = stepHand(a.state, { type: 'fold' });
  expect(end.events.filter((e) => e.kind === 'showdownRevealed')).toEqual([]);
  expect(end.state.result?.showdownCards).toEqual([]);
  const input = {
    ...handInput('S02'),
    players: [
      { seatId: 0 as const, participantId: 'a', stack: 2000 },
      { seatId: 1 as const, participantId: 'b', stack: 2000 },
      { seatId: 2 as const, participantId: 'c', stack: 2000 },
    ],
  };
  let s = createHand(input).state;
  s = stepHand(s, { type: 'fold' }).state;
  for (let i = 0; i < 20 && s.phase !== 'settled'; i++) {
    const actor = s.betting!.actorSeatId!,
      p = s.players.find((p) => p.seatId === actor)!;
    s = stepHand(s, { type: s.betting!.currentBet > p.streetCommitted ? 'call' : 'check' }).state;
  }
  expect(s.phase).toBe('settled');
  expect(s.result?.showdownCards.map((p) => p.seatId)).toEqual([1, 2]);
  expect(s.result?.settlement.plan.pots.every((p) => !p.eligibleSeatIds.includes(0))).toBe(true);
});

import { expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import {
  createHand,
  applyHandAction,
  advanceHand,
  getHandLegalActions,
} from '../../packages/poker-core/src/state.js';
import { createDeck } from '../../packages/poker-core/src/cards.js';
import { beginBettingRound, getRoundOutcome } from '../../packages/poker-core/src/betting.js';
import { handFixture, handInput, passiveVariants } from '../helpers/hand-scenarios.js';
import { stepHand, passiveHand } from '../helpers/hand-replay.js';
import { array, record, integer, seat } from '../helpers/fixture-read.js';
import { expectedPlayer } from '../helpers/position-scenarios.js';
const traces: unknown[] = [];
for (const { input, expected: e } of passiveVariants())
  it('S01 real ' + input.players.length + ' player passive hand matches frozen outcomes', () => {
    const start = createHand(input),
      before = structuredClone(start.state),
      r = passiveHand(input),
      s = r.state;
    expect(s.phase).toBe(e.phase);
    expect(s.board).toEqual(e.board);
    expect(s.burnCards).toHaveLength(integer(e.burnCount));
    expect(s.deck.cursor).toBe(e.consumed);
    expect(s.result?.settlement.plan.payoutTotal).toBe(e.matchedPotBeforePayout);
    expect(
      [...new Set(s.result?.settlement.plan.pots.flatMap((p) => p.winnerSeatIds))].sort(),
    ).toEqual(e.winnerSeatIds);
    expect(Object.fromEntries(s.players.map((p) => [p.seatId, p.stack]))).toEqual(e.finalStacks);
    expect(s.players.every((p) => p.handCommitted === 0 && p.streetCommitted === 0)).toBe(true);
    expect(s.settlementCount).toBe(1);
    expect(s.turnId).toBeNull();
    expect(s.betting).toBeNull();
    expect(start.state).toEqual(before);
    expect(s.players.every(Object.isFrozen)).toBe(true);
    traces.push({ playerCount: input.players.length, trace: r.trace });
    const stage = /^w(?:12|13|14|15|16|17|18|19|20)$/.test(process.env.ORBIT_VERIFY_STAGE ?? '')
      ? process.env.ORBIT_VERIFY_STAGE
      : 'scratch';
    writeFileSync(
      `docs/verification/${stage}-hand-traces.json`,
      JSON.stringify({ scope: 'fixed test decks, private internal hand traces', traces }, null, 2) +
        '\n',
    );
  });
it('starts with actual round-by-round hole cards, blinds and unacted big blind', () => {
  const s = createHand(handInput('S02')).state;
  expect(s.players.map((p) => p.holeCards)).toEqual([
    ['3S', '5S'],
    ['2S', '4S'],
  ]);
  expect(
    s.players.map((p) => [p.stack, p.streetCommitted, p.startingStack, p.lastActedAtBet]),
  ).toEqual([
    [1990, 10, 2000, null],
    [1980, 20, 2000, null],
  ]);
  expect(s.betting?.pendingSeatIds).toEqual([0, 1]);
  expect(s.handVersion).toBe(1);
  expect(s.turnId).toBe('S02:turn:1');
});
it('S02 folds without dealing or revealing and S05 never settles the real terminal state twice', () => {
  const initial = createHand(handInput('S02')),
    result = stepHand(initial.state, { type: 'fold' }),
    s = result.state,
    e = handFixture('S02').expected;
  expect(s.phase).toBe(e.phase);
  expect(s.board).toEqual(e.board);
  expect(s.burnCards).toEqual(e.burnCards);
  expect(s.result?.refunds).toEqual(e.refunds);
  expect(
    s.result?.settlement.plan.pots
      .flatMap((p) => p.allocations)
      .sort((a, b) => a.seatId - b.seatId),
  ).toEqual(e.payouts);
  expect(Object.fromEntries(s.players.map((p) => [p.seatId, p.stack]))).toEqual(e.finalStacks);
  expect(s.result?.showdownCards).toEqual([]);
  expect(s.settlementCount).toBe(e.settlementCount);
  const five = handFixture('S05');
  for (let i = 0; i < integer(five.when.count); i++) {
    const next = advanceHand(s);
    expect(next.state).toBe(s);
    expect(next.events).toEqual(five.expected.events);
    expect(next.state.settlementCount).toBe(five.expected.settlementCount);
  }
  expect(applyHandAction(s, { seatId: 0, turnId: 'old', action: { type: 'fold' } })).toMatchObject({
    ok: false,
    reason: 'HAND_SETTLED',
    state: s,
    events: [],
  });
  expect(s.handVersion).toBe(2);
});
it('S03 runs out after two real all-ins with zero empty turns', () => {
  let s = createHand(handInput('S03')).state;
  s = stepHand(s, { type: 'allIn' }).state;
  expect(s.board).toEqual([]);
  const last = stepHand(s, { type: 'allIn' });
  s = last.state;
  const e = handFixture('S03').expected;
  expect(s.board).toEqual(e.board);
  expect(s.burnCards).toEqual(e.burnCards);
  expect(s.deck.cursor).toBe(e.consumed);
  expect(s.result?.settlement.plan.payoutTotal).toBe(e.potBeforePayout);
  expect(
    s.result?.settlement.plan.pots
      .flatMap((p) => p.allocations)
      .sort((a, b) => a.seatId - b.seatId),
  ).toEqual(e.payouts);
  expect(Object.fromEntries(s.result!.showdownCards.map((p) => [p.seatId, p.cards]))).toEqual(
    e.publicHoleCards,
  );
  expect(s.turnSerial).toBe(2);
  expect(s.settlementCount).toBe(e.settlementCount);
  expect(Object.fromEntries(s.players.map((p) => [p.seatId, p.stack]))).toEqual(e.finalStacks);
});
it('refunds an unmatched all-in before the first board card and never pays the refund twice', () => {
  const input = handInput('S03');
  let s = createHand({
    ...input,
    players: input.players.map((p) => ({ ...p, stack: p.seatId === 0 ? 200 : 100 })),
  }).state;
  s = stepHand(s, { type: 'allIn' }).state;
  const result = stepHand(s, { type: 'allIn' });
  s = result.state;
  expect(s.result?.refunds).toEqual([{ seatId: 0, amount: 100 }]);
  expect(s.result?.settlement.plan.refundTotal).toBe(0);
  expect(s.result?.settlement.plan.payoutTotal).toBe(200);
  expect(s.players.map((p) => p.stack)).toEqual([200, 100]);
  expect(result.events.findIndex((e) => e.kind === 'refunded')).toBeLessThan(
    result.events.findIndex((e) => e.kind === 'boardDealt'),
  );
  expect(s.players.reduce((sum, p) => sum + p.stack + p.handCommitted, 0)).toBe(300);
});
it('S04 reads its partial snapshot and protects a reachable sole-funded preflop debtor', () => {
  const raw = handFixture('S04'),
    players = array(raw.given.players).map(expectedPlayer);
  const base = beginBettingRound({ street: 'flop', bigBlind: 20, players, actionOrder: [0, 1] });
  const round = {
    ...base,
    players,
    currentBet: integer(raw.given.currentBet),
    lastFullRaiseSize: integer(raw.given.lastFullRaiseSize),
    actorSeatId: seat(raw.given.actorSeatId),
    pendingSeatIds: [seat(raw.given.actorSeatId)],
  };
  expect(getRoundOutcome(round)).toBe('continue');
  const input = handInput('S02');
  let s = createHand({
    ...input,
    dealerSeatId: 1,
    players: input.players.map((p) => ({ ...p, stack: p.seatId === 0 ? 300 : 200 })),
  }).state;
  s = stepHand(s, { type: 'call' }).state;
  s = stepHand(s, { type: 'raise', raiseTo: 120 }).state;
  s = stepHand(s, { type: 'allIn' }).state;
  expect(s.phase).toBe('preflop');
  expect(s.board).toEqual([]);
  expect(getHandLegalActions(s, 0)).toMatchObject({
    callAmount: 80,
    allowed: raw.expected.legalActions,
  });
  expect(advanceHand(s).state).toBe(s);
  expect(stepHand(s, { type: 'call' }).state.phase).toBe('settled');
});
it('S04 protects a real flop debtor before dealing any additional board cards', () => {
  const input = handInput('S02');
  let s = createHand({
    ...input,
    dealerSeatId: 1,
    players: input.players.map((p) => ({ ...p, stack: p.seatId === 0 ? 220 : 120 })),
  }).state;
  s = stepHand(s, { type: 'call' }).state;
  s = stepHand(s, { type: 'check' }).state;
  s = stepHand(s, { type: 'bet', raiseTo: 20 }).state;
  s = stepHand(s, { type: 'allIn' }).state;
  const e = handFixture('S04').expected;
  expect(s.phase).toBe(e.phase);
  expect(s.betting?.actorSeatId).toBe(e.actorSeatId);
  expect(s.board).toHaveLength(3);
  expect(getHandLegalActions(s, 0)).toMatchObject({
    callAmount: e.callAmount,
    allowed: e.legalActions,
  });
  expect(advanceHand(s)).toEqual({ state: s, events: [] });
});
it('rejects wrong turns and invalid amounts without changing complete private state or versions', () => {
  const s = createHand(handInput('S02')).state,
    before = structuredClone(s);
  for (const request of [
    { seatId: 0 as const, turnId: 'stale', action: { type: 'fold' } },
    { seatId: 1 as const, turnId: s.turnId!, action: { type: 'fold' } },
    { seatId: 0 as const, turnId: s.turnId!, action: { type: 'raise', raiseTo: NaN } },
  ]) {
    const r = applyHandAction(s, request);
    expect(r.ok).toBe(false);
    expect(r.state).toBe(s);
    expect(r.events).toEqual([]);
    expect(s).toEqual(before);
  }
  const r = stepHand(s, { type: 'call' });
  expect(r.state.players[0]?.stack).toBe(1980);
  expect(r.state.players[0]?.participantId).toBe(s.players[0]?.participantId);
  expect(r.state.players[0]?.holeCards).toEqual(s.players[0]?.holeCards);
  expect(r.state.handVersion).toBe(2);
  expect(r.state.turnId).not.toBe(s.turnId);
  expect(advanceHand(r.state).state).toBe(r.state);
});
it('handles forced short-blind runouts but keeps the sole funded debtor', () => {
  const input = handInput('S02');
  const all = createHand({
    ...input,
    players: input.players.map((p) => ({ ...p, stack: 5 })),
  }).state;
  expect(all.phase).toBe('settled');
  expect(all.turnSerial).toBe(0);
  expect(all.board).toHaveLength(5);
  const three = createHand({
    handId: 'short',
    dealerSeatId: 0,
    deck: createDeck(),
    players: [
      { seatId: 0, participantId: 'a', stack: 2000 },
      { seatId: 1, participantId: 'b', stack: 5 },
      { seatId: 2, participantId: 'c', stack: 7 },
    ],
  }).state;
  expect(three.phase).toBe('preflop');
  expect(three.betting?.currentBet).toBe(20);
  expect(three.betting?.pendingSeatIds).toEqual([0]);
  expect(getHandLegalActions(three, 0).callAmount).toBe(20);
});
it('validates all hand inputs before dealing and refuses unsafe versions', () => {
  const input = handInput('S02');
  for (const malformed of [
    { ...input, handId: '' },
    { ...input, players: input.players.map((p) => ({ ...p, participantId: 'same' })) },
    { ...input, players: input.players.map((p) => ({ ...p, stack: Number.MAX_SAFE_INTEGER })) },
    { ...input, deck: input.deck.slice(1) },
  ]) {
    const copy = structuredClone(malformed);
    expect(() => createHand(malformed)).toThrow();
    expect(malformed).toEqual(copy);
  }
  const s = createHand(input).state;
  expect(() => stepHand({ ...s, handVersion: Number.MAX_SAFE_INTEGER }, { type: 'call' })).toThrow(
    'UNSAFE_HAND_COUNTER',
  );
});
it('freezes success, every rejection shell and its empty events without freezing a caller-owned state', () => {
  const s = createHand(handInput('S02')).state;
  const success = stepHand(s, { type: 'call' });
  expect(Object.isFrozen(success)).toBe(true);
  for (const request of [
    { seatId: 0 as const, turnId: 'old', action: { type: 'fold' } },
    { seatId: 1 as const, turnId: s.turnId!, action: { type: 'fold' } },
    { seatId: 0 as const, turnId: s.turnId!, action: { type: 'check' } },
  ]) {
    const r = applyHandAction(s, request);
    expect(r.ok).toBe(false);
    expect(Object.isFrozen(r)).toBe(true);
    expect(Object.isFrozen(r.events)).toBe(true);
  }
  const terminal = stepHand(s, { type: 'fold' }).state,
    rejected = applyHandAction(terminal, { seatId: 0, turnId: 'old', action: { type: 'fold' } });
  expect(Object.isFrozen(rejected)).toBe(true);
  expect(Object.isFrozen(rejected.events)).toBe(true);
  const mutable = structuredClone(s);
  applyHandAction(mutable, { seatId: 0, turnId: 'old', action: { type: 'fold' } });
  advanceHand(mutable);
  expect(Object.isFrozen(mutable)).toBe(false);
});
it('fails counter overflows and exhausted automatic dealing atomically', () => {
  const s = createHand(handInput('S02')).state;
  for (const damaged of [
    { ...s, turnSerial: Number.MAX_SAFE_INTEGER },
    { ...s, eventSequence: Number.MAX_SAFE_INTEGER },
  ]) {
    const before = structuredClone(damaged);
    expect(() => stepHand(damaged, { type: 'call' })).toThrow('UNSAFE_HAND_COUNTER');
    expect(damaged).toEqual(before);
  }
  const bb = stepHand(s, { type: 'call' }).state,
    damaged = { ...bb, deck: { ...bb.deck, cursor: 52 } },
    before = structuredClone(damaged);
  expect(() => stepHand(damaged, { type: 'check' })).toThrow('DECK_EXHAUSTED');
  expect(damaged).toEqual(before);
});
it('changes turn identity for the same actor across streets and stamps every event with the resulting revision', () => {
  const initial = createHand(handInput('S02'));
  expect(initial.events.every((e) => e.handVersion === 1)).toBe(true);
  const bb = stepHand(initial.state, { type: 'call' }).state,
    next = stepHand(bb, { type: 'check' });
  expect(bb.betting?.actorSeatId).toBe(1);
  expect(next.state.betting?.actorSeatId).toBe(1);
  expect(next.state.phase).toBe('flop');
  expect(next.state.turnId).not.toBe(bb.turnId);
  expect(next.events.every((e) => e.handVersion === next.state.handVersion)).toBe(true);
});

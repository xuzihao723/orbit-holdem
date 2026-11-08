import { expect, it } from 'vitest';
import { projectBotObservation } from '../../apps/server/src/bots/observation.js';
import { botPrivacyContext } from '../helpers/bot-privacy-scenarios.js';
import {
  createHand,
  createDeck,
  applyHandAction,
  getHandLegalActions,
  assertHandInvariants,
} from '../../packages/poker-core/src/index.js';
import { withTurnClock } from '../../apps/server/src/game/turn-timer.js';
it('isolates four actual bot actors and retains only the latest 64 public action summaries', () => {
  const f = botPrivacyContext(),
    base = f.rooms[0]!;
  let hand = createHand({
    handId: 'four-bots',
    dealerSeatId: 3,
    deck: createDeck(),
    players: [0, 1, 2, 3].map((i) => ({
      seatId: i as 0 | 1 | 2 | 3,
      participantId: 'bot-' + i,
      stack: 2000,
    })),
  }).state;
  const observed = new Set<string>();
  for (let i = 0; i < 4; i++) {
    const participants = hand.players.map((p) => ({
        ...base.participants[0]!,
        participantId: p.participantId,
        seatId: p.seatId,
        stack: p.stack,
        botId: p.participantId,
      })),
      state = withTurnClock(
        {
          ...base,
          hand,
          participants,
          row: { ...base.row, capacity: 4 },
          publicActions: Array.from({ length: 100 }, (_, sequence) => ({
            sequence,
            seatId: 0,
            actionType: 'check',
            paidAmount: 0,
            raiseTo: null,
          })),
        },
        0,
      ),
      id = hand.players.find((p) => p.seatId === hand.betting!.actorSeatId)!.participantId,
      o = projectBotObservation(state, id)!;
    expect(o.holeCards).toEqual(hand.players.find((p) => p.participantId === id)!.holeCards);
    for (const p of hand.players.filter((p) => p.participantId !== id))
      for (const card of p.holeCards) expect(JSON.stringify(o)).not.toContain('"' + card + '"');
    expect(o.recentActions).toHaveLength(64);
    expect(o.recentActions[0]!.sequence).toBe(36);
    observed.add(id);
    const legal = getHandLegalActions(hand, o.seatId),
      next = applyHandAction(hand, {
        seatId: o.seatId,
        turnId: o.turnId,
        action: { type: legal.allowed.includes('check') ? 'check' : 'call' },
      });
    expect(next.ok).toBe(true);
    if (!next.ok) throw Error(next.reason);
    hand = next.state;
    assertHandInvariants(hand);
  }
  expect(observed.size).toBe(4);
});
it('PRIV04 replaces complete legal hidden states without changing the frozen bot observation or seeded intent', () => {
  const f = botPrivacyContext(),
    a = projectBotObservation(f.rooms[0]!, f.botId),
    b = projectBotObservation(f.rooms[1]!, f.botId);
  expect(a).toEqual(b);
  expect(a).toMatchObject({ holeCards: f.own, board: f.board, deadline: 30000 });
  const policy = (v: NonNullable<typeof a>, seed: number) => ({
    type: v.legalActions.allowed[seed % v.legalActions.allowed.length],
    cards: [...v.holeCards],
  });
  expect(policy(a!, f.seed)).toEqual(policy(b!, f.seed));
  expect(JSON.stringify(a)).not.toMatch(/deck|burnCards|opponentHoleCards|session|resumeToken/);
  for (const bad of ['KS', 'QH', '2C', '3C', '5D', '6D', '9D', '10D'])
    expect(JSON.stringify(a)).not.toContain('"' + bad + '"');
  expect(Object.isFrozen(a!.players[0])).toBe(true);
  expect(() => {
    a!.holeCards[0] = '2C';
  }).toThrow();
  expect(f.rooms[0]!.hand!.players[0]!.holeCards).toEqual(f.own);
});
it('returns no observation for another bot, an exited actor, a paused room or absent deadline', () => {
  const f = botPrivacyContext(),
    r = f.rooms[0]!;
  expect(projectBotObservation(r, 'bot-b')).toBeNull();
  expect(
    projectBotObservation(
      { ...r, participants: r.participants.map((p) => ({ ...p, admission: 'leaving' })) },
      f.botId,
    ),
  ).toBeNull();
  expect(
    projectBotObservation({ ...r, row: { ...r.row, status: 'pausedFault' } }, f.botId),
  ).toBeNull();
  expect(projectBotObservation({ ...r, turnClock: null }, f.botId)).toBeNull();
});

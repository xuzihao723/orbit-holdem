import { expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { unknownCards, sampleUnknown } from '../../apps/server/src/bots/sampling.js';
import { estimateEquity, settleEquitySample } from '../../apps/server/src/bots/equity.js';
import { chooseStandardAction } from '../../apps/server/src/bots/policy-monte-carlo.js';
import { royalCase, seededRandom } from '../helpers/equity-cases.js';
import { botPrivacyContext } from '../helpers/bot-privacy-scenarios.js';
import { projectBotObservation } from '../../apps/server/src/bots/observation.js';
import { allInLeaveScenario } from '../helpers/lifecycle-scenarios.js';
import { cards, record } from '../helpers/fixture-read.js';
it('uses the complete preflop table tier in the shared position and cost framework before any sample exists', () => {
  const o = {
    ...royalCase(),
    phase: 'preflop' as const,
    board: [],
    holeCards: ['2S', '2H'] as ['2S', '2H'],
    legalActions: {
      allowed: ['fold', 'call'] as ('fold' | 'call')[],
      callAmount: 20,
      minRaiseTo: null,
      maxRaiseTo: null,
      allIn: null,
    },
    potTotal: 200,
  };
  expect(chooseStandardAction(o, { next: () => 0.99 })).toEqual({ type: 'call' });
});
it('does not count a refund to another player as an eligible hero pot', () => {
  const o = royalCase(2, [0, 100]),
    e = estimateEquity(o, seededRandom(), 10, { shouldStop: () => false });
  expect(e.weightedShare).toBe(0);
  expect(e.expectedReturn).toBe(0);
  expect(e.expectedNet).toBe(0);
});
it('reuses LIFE04 actual visible ranks and excludes ineligible side pots while separating the 150 refund', () => {
  const f = allInLeaveScenario(),
    holes = record(f.given.settlementHoleCards),
    o = royalCase(3, [100, 250, 400]);
  o.holeCards = ['AH', '5H'];
  o.board = cards(f.given.settlementBoard);
  o.players = o.players.map((p) => ({ ...p, stack: 0, allIn: true }));
  const sample = {
    board: [...o.board],
    opponents: [
      {
        seatId: 1 as const,
        holeCards: cards(holes.B) as [(typeof o.holeCards)[0], (typeof o.holeCards)[1]],
      },
      {
        seatId: 2 as const,
        holeCards: cards(holes.C) as [(typeof o.holeCards)[0], (typeof o.holeCards)[1]],
      },
    ],
  };
  expect(settleEquitySample(o, sample)).toMatchObject({
    heroReturn: 300,
    weightedShare: 1,
    contributionTotal: 750,
    paidTotal: 750,
  });
  const c = {
    ...o,
    participantId: o.players[2]!.participantId,
    seatId: 2 as const,
    holeCards: sample.opponents[1]!.holeCards,
  };
  expect(
    settleEquitySample(c, {
      board: [...o.board],
      opponents: [{ seatId: 0, holeCards: o.holeCards }, sample.opponents[0]!],
    }),
  ).toMatchObject({ heroReturn: 150, weightedShare: 0, paidTotal: 750 });
});
it('excludes exactly the known cards and samples opponents and board without replacement', () => {
  const o = { ...royalCase(4), phase: 'flop' as const, board: ['10S', 'JS', 'QS'] as const },
    known = [...o.holeCards, ...o.board],
    pool = unknownCards(o);
  expect(pool).toHaveLength(47);
  for (const card of known) expect(pool).not.toContain(card);
  const rng = seededRandom();
  for (let i = 0; i < 100; i++) {
    const sample = sampleUnknown(o, rng),
      drawn = [...sample.board.slice(3), ...sample.opponents.flatMap((p) => p.holeCards)];
    expect(drawn).toHaveLength(8);
    expect(new Set(drawn).size).toBe(8);
    for (const c of drawn) expect(known).not.toContain(c);
  }
  expect(
    unknownCards({
      ...o,
      players: o.players.map((p, i) => (i === 1 ? { ...p, folded: true } : p)),
    }),
  ).toEqual(pool);
});
it.each([2, 3, 4] as const)(
  'estimates the exact board-royal-flush %i-way tie using actual completed samples',
  (n) => {
    const o = royalCase(n),
      estimate = estimateEquity(o, seededRandom(), 1000, { shouldStop: () => false });
    expect(estimate.completedSamples).toBe(1000);
    expect(estimate.weightedShare).toBeCloseTo(1 / n, 10);
    expect(estimate.expectedReturn).toBe(100);
    expect(estimate.expectedNet).toBe(100);
    expect(estimate.stopReason).toBe('completed');
  },
);
it('limits a short hero to its main-pot share rather than multiplying all side pots by win rate', () => {
  const o = royalCase(3, [100, 250, 400]),
    e = estimateEquity(o, seededRandom(), 50, { shouldStop: () => false });
  expect(e.weightedShare).toBeCloseTo(1 / 3);
  expect(e.expectedReturn).toBe(100);
  const sampled = sampleUnknown(o, seededRandom()),
    s = settleEquitySample(o, sampled);
  expect(s.contributionTotal).toBe(750);
  expect(s.paidTotal).toBe(750);
});
it('uses actual odd-chip awards, folded dead money and all-in eligibility', () => {
  const o = royalCase(3, [1, 1, 1]);
  o.players = o.players.map((p, i) => ({
    ...p,
    folded: i === 2,
    allIn: i === 0,
    stack: i === 0 ? 0 : p.stack,
  }));
  expect(estimateEquity(o, seededRandom(), 10, { shouldStop: () => false }).expectedReturn).toBe(1);
  o.dealerSeatId = 1;
  expect(estimateEquity(o, seededRandom(), 10, { shouldStop: () => false }).expectedReturn).toBe(2);
});
it('keeps refunds separate from pot share and applies only the actual additional short call cost', () => {
  const o = royalCase(3, [400, 250, 100]),
    s = settleEquitySample(o, sampleUnknown(o, seededRandom()));
  expect(s.heroReturn).toBe(400);
  expect(s.paidTotal).toBe(750);
  const short = royalCase(2, [10, 100]);
  short.players = short.players.map((p, i) => (i === 0 ? { ...p, stack: 5 } : p));
  short.legalActions = {
    allowed: ['fold', 'allIn'],
    callAmount: 90,
    minRaiseTo: null,
    maxRaiseTo: null,
    allIn: { raiseTo: 15, additionalAmount: 5, kind: 'call' },
  };
  const e = estimateEquity(short, seededRandom(), 10, { shouldStop: () => false });
  expect(e.additionalCallCost).toBe(5);
  expect(e.expectedReturn).toBe(15);
  expect(e.expectedNet).toBe(10);
});
it('returns actual partial and cancelled counts, with zero-sample policy falling back safely', () => {
  const o = royalCase(),
    zero = estimateEquity(o, seededRandom(), 1000, {
      shouldStop: () => true,
      reason: () => 'cancelled',
    });
  expect(zero).toMatchObject({
    requestedSamples: 1000,
    completedSamples: 0,
    weightedShare: 0,
    stopReason: 'cancelled',
  });
  expect(chooseStandardAction(o, { next: () => 0.99 }, zero)).toEqual({ type: 'check' });
  let checks = 0;
  const partial = estimateEquity(o, seededRandom(), 1000, { shouldStop: () => ++checks > 7 });
  expect(partial.completedSamples).toBe(7);
  expect(partial.stopReason).toBe('budget');
});
it('keeps identical seeded estimates when real hidden states are replaced and never mutates its input', () => {
  const f = botPrivacyContext(),
    a = projectBotObservation(f.rooms[0]!, f.botId)!,
    b = projectBotObservation(f.rooms[1]!, f.botId)!,
    before = JSON.stringify(a);
  expect(estimateEquity(a, seededRandom(f.seed), 50, { shouldStop: () => false })).toEqual(
    estimateEquity(b, seededRandom(f.seed), 50, { shouldStop: () => false }),
  );
  expect(JSON.stringify(a)).toBe(before);
});
it('rejects malformed known sets, phase lengths, invalid random draws and unsafe sample requests', () => {
  const o = royalCase();
  expect(() => unknownCards({ ...o, holeCards: ['AS', '3D'] })).toThrow();
  expect(() => unknownCards({ ...o, phase: 'flop' })).toThrow();
  expect(() => sampleUnknown(o, { next: () => 1 })).toThrow();
  for (const count of [0, -1, 1.5, 10001])
    expect(() => estimateEquity(o, seededRandom(), count, { shouldStop: () => false })).toThrow();
});
it('folds negative-net paid calls, preserves free checks and respects raise and short-all-in permissions', () => {
  const o = royalCase(),
    e = estimateEquity(o, seededRandom(), 1, { shouldStop: () => false }),
    paid = {
      ...o,
      legalActions: {
        allowed: ['fold', 'call'] as ('fold' | 'call')[],
        callAmount: 20,
        minRaiseTo: null,
        maxRaiseTo: null,
        allIn: null,
      },
    };
  expect(chooseStandardAction(paid, { next: () => 0 }, { ...e, expectedNet: -1 })).toEqual({
    type: 'fold',
  });
  expect(
    chooseStandardAction(paid, { next: () => 0 }, { ...e, expectedNet: 1, weightedShare: 0.9 }),
  ).toEqual({ type: 'call' });
  expect(
    chooseStandardAction(
      {
        ...paid,
        legalActions: {
          ...paid.legalActions,
          allowed: ['fold', 'allIn'],
          allIn: { raiseTo: 20, additionalAmount: 20, kind: 'call' },
        },
      },
      { next: () => 0 },
      { ...e, expectedNet: 1 },
    ),
  ).toEqual({ type: 'allIn' });
  expect(chooseStandardAction(o, { next: () => 0.99 }, { ...e, expectedNet: -1 })).toEqual({
    type: 'check',
  });
  expect(chooseStandardAction(o, { next: () => 0 }, { ...e, weightedShare: 0.9 })).toEqual({
    type: 'bet',
    raiseTo: 40,
  });
});
it('records a real 1000-sample timing baseline without promising a worker budget', () => {
  const o = projectBotObservation(botPrivacyContext().rooms[0]!, 'bot-a')!,
    start = performance.now(),
    e = estimateEquity(o, seededRandom(), 1000, { shouldStop: () => false }),
    elapsedMs = performance.now() - start;
  expect(e.completedSamples).toBe(1000);
  writeFileSync(
    `docs/verification/${process.env.ORBIT_VERIFY_STAGE ?? 'scratch'}-equity-baseline.json`,
    JSON.stringify(
      {
        date: '2026-11-01',
        requestedSamples: 1000,
        completedSamples: e.completedSamples,
        elapsedMs,
        estimate: e,
        model: 'uniform unknown; current contributions plus capped hero call; no future betting',
        credentialsIncluded: false,
      },
      null,
      2,
    ) + '\n',
  );
});

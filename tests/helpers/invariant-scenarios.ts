import { scenario, array, integer, text, bool } from './fixture-read.js';
export const INVALID_CLASSES = [
  'wrongActor',
  'negativeRaise',
  'fractionalRaise',
  'belowMinimumNonAllInRaise',
  'overStackRaise',
  'checkWhileFacingBet',
  'raiseWithoutReopening',
  'unsafeInteger',
  'nonFiniteNumber',
] as const;
export type InvalidClass = (typeof INVALID_CLASSES)[number];
export function invariantFixtures() {
  const a = scenario('I01', ['simulateLegalHandsAndCheckEveryStep']),
    b = scenario('I02', ['generateAndRejectInvalidActions']);
  const classes = array(b.given.invalidClasses).map(text);
  if (
    JSON.stringify(classes) !== JSON.stringify(INVALID_CLASSES) ||
    !bool(a.expected.failOnActionLimit) ||
    text(a.given.randomSource) !== 'testOnlySeededGenerator'
  )
    throw new Error('INVALID_INVARIANT_FIXTURE');
  return {
    legal: {
      seed: integer(a.given.seed),
      hands: integer(a.given.hands),
      maxActionsPerHand: integer(a.given.maxActionsPerHand),
      initialStackPerSeat: integer(a.given.initialStackPerSeat),
      playerCounts: array(a.given.playerCounts).map((v) => {
        const n = integer(v);
        if (n !== 2 && n !== 3 && n !== 4) throw new Error('INVALID_FIXTURE_PLAYER_COUNT');
        return n;
      }),
    },
    invalid: {
      seed: integer(b.given.seed),
      samples: integer(b.given.samples),
      classes: [...INVALID_CLASSES],
    },
    expectedLegal: { completedHands: integer(a.expected.completedHands) },
    expectedInvalid: { rejectedCount: integer(b.expected.rejectedCount) },
  };
}

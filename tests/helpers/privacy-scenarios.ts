import { scenario, record, cards, text, integer, numbers } from './fixture-read.js';
import { createDeck } from '../../packages/poker-core/src/index.js';
export function privacyScenario() {
  const raw = scenario('PRIV01', ['projectPublicAndOwnerViews']),
    holes = record(raw.given.holeCards),
    expected = raw.expected;
  const owners = ['A', 'B', 'C'].map((name) => {
    const own = cards(holes[name]);
    if (own.length !== 2) throw Error('PAIR');
    return own;
  });
  const burn = cards(raw.given.burnCards),
    board = cards(raw.given.board),
    future = cards(raw.given.futureCards);
  if (text(raw.given.phase) !== 'flop' || JSON.stringify(raw.given.foldedPlayerIds) !== '["B"]')
    throw Error('PREMISE');
  const prefix = [
    owners[0]![0]!,
    owners[1]![0]!,
    owners[2]![0]!,
    owners[0]![1]!,
    owners[1]![1]!,
    owners[2]![1]!,
    burn[0]!,
    ...board,
    future[0]!,
  ];
  return {
    owners,
    board,
    expected,
    omitted: cards(expected.publicMustOmitCardIds),
    deck: [...prefix, ...createDeck().filter((c) => !prefix.includes(c))],
  };
}
export function waitingSequences() {
  const x = scenario('PRIV03', ['projectWaitingViewAndReplayAccess']);
  return {
    watermark: integer(x.given.joinedAtEventSequence),
    before: numbers(x.given.publicEventSequencesBeforeJoin),
    after: numbers(x.given.publicEventSequencesAfterJoin),
    expected: numbers(x.expected.newPublicEventSequences),
  };
}

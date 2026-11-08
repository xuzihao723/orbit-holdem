import { dealNextStreet, type DealtHand } from './deck.js';
import { beginBettingRound, getRoundOutcome } from './betting-round.js';
import { handRound, mergeHandRound } from './hand-betting.js';
import { emit, nextCounter, type HandWork } from './hand-internal.js';
import { refundUnmatched, settleHand } from './hand-settlement.js';
function nextStreet(work: HandWork, street: 'flop' | 'turn' | 'river'): void {
  const s = work.state,
    prior: DealtHand = {
      deck: s.deck,
      board: s.board,
      burnCards: s.burnCards,
      dealOrder: s.positions.dealOrder,
      holeCards: Object.fromEntries(s.players.map((p) => [p.seatId, p.holeCards])),
    };
  const dealt = dealNextStreet(prior, street);
  work.state = {
    ...s,
    deck: dealt.deck,
    board: dealt.board,
    burnCards: dealt.burnCards,
    phase: street,
  };
  emit(work, {
    kind: 'cardBurned',
    visibility: 'internal',
    card: dealt.burnCards[dealt.burnCards.length - 1]!,
  });
  emit(work, {
    kind: 'boardDealt',
    visibility: 'public',
    street,
    cards: dealt.board.slice(s.board.length),
  });
}
export function progressHand(work: HandWork): void {
  for (let step = 0; step < 4; step++) {
    const outcome = getRoundOutcome(handRound(work.state));
    if (outcome === 'continue') {
      const turnSerial = nextCounter(work.state.turnSerial);
      work.state = { ...work.state, turnSerial, turnId: work.state.handId + ':turn:' + turnSerial };
      return;
    }
    if (outcome === 'uncontested') {
      settleHand(work, 'allOthersFolded');
      return;
    }
    if (outcome === 'runout') {
      refundUnmatched(work);
      work.state = { ...work.state, betting: null, turnId: null };
      for (const street of ['flop', 'turn', 'river'] as const) {
        const needed = street === 'flop' ? 0 : street === 'turn' ? 3 : 4;
        if (work.state.board.length === needed) nextStreet(work, street);
      }
      settleHand(work, 'showdown');
      return;
    }
    if (work.state.phase === 'river') {
      settleHand(work, 'showdown');
      return;
    }
    const street =
      work.state.phase === 'preflop'
        ? 'flop'
        : work.state.phase === 'flop'
          ? 'turn'
          : work.state.phase === 'turn'
            ? 'river'
            : null;
    if (!street) throw new Error('INVALID_HAND_STATE');
    nextStreet(work, street);
    work.state = mergeHandRound(
      work.state,
      beginBettingRound({
        street,
        bigBlind: 20,
        players: work.state.players,
        actionOrder: work.state.positions.postflopOrder,
      }),
    );
  }
  throw new Error('HAND_PROGRESS_STALLED');
}

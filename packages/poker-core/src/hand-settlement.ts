import { buildPotLayers } from './pots.js';
import { rankShowdown, settleBalances } from './settlement.js';
import type { HandWork } from './hand-internal.js';
import { emit } from './hand-internal.js';
export function refundUnmatched(work: HandWork): void {
  const { refunds } = buildPotLayers(
    work.state.players.map((p) => ({
      seatId: p.seatId,
      amount: p.handCommitted,
      folded: p.folded,
    })),
  );
  work.state = {
    ...work.state,
    players: work.state.players.map((p) => {
      const refund = refunds.find((r) => r.seatId === p.seatId)?.amount ?? 0;
      return {
        ...p,
        stack: p.stack + refund,
        handCommitted: p.handCommitted - refund,
        streetCommitted: p.streetCommitted - Math.min(p.streetCommitted, refund),
        allIn: p.stack + refund === 0,
      };
    }),
    issuedRefunds: [...work.state.issuedRefunds, ...refunds],
  };
  for (const refund of refunds) emit(work, { kind: 'refunded', visibility: 'public', ...refund });
}
export function settleHand(work: HandWork, reason: 'showdown' | 'allOthersFolded'): void {
  if (work.state.settlementCount !== 0 || work.state.result !== null)
    throw new Error('HAND_ALREADY_SETTLED');
  const showdownCards =
    reason === 'showdown'
      ? work.state.players
          .filter((p) => !p.folded)
          .map((p) => ({ seatId: p.seatId, cards: p.holeCards }))
      : [];
  const ranks =
    reason === 'showdown'
      ? rankShowdown(
          work.state.board,
          showdownCards.map((p) => ({ seatId: p.seatId, holeCards: p.cards })),
        )
      : [];
  const settlement = settleBalances({
    players: work.state.players.map((p) => ({
      seatId: p.seatId,
      stack: p.stack,
      streetCommitted: p.streetCommitted,
      amount: p.handCommitted,
      folded: p.folded,
    })),
    dealerSeatId: work.state.positions.dealerSeatId,
    ranks,
    reason,
  });
  for (const refund of settlement.plan.refunds)
    emit(work, { kind: 'refunded', visibility: 'public', ...refund });
  emit(work, { kind: 'potsBuilt', visibility: 'public', pots: settlement.plan.pots });
  if (reason === 'showdown')
    emit(work, { kind: 'showdownRevealed', visibility: 'public', cards: showdownCards });
  for (const pot of settlement.plan.pots)
    for (const allocation of pot.allocations)
      emit(work, { kind: 'paidOut', visibility: 'public', potId: pot.potId, ...allocation });
  const refunds = [...work.state.issuedRefunds, ...settlement.plan.refunds];
  work.state = {
    ...work.state,
    phase: 'settled',
    players: work.state.players.map((p) => ({
      ...p,
      ...settlement.finalBalances.find((b) => b.seatId === p.seatId)!,
      allIn: false,
      lastActedAtBet: null,
    })),
    betting: null,
    turnId: null,
    settlementCount: 1,
    issuedRefunds: refunds,
    result: { reason, settlement, refunds, showdownCards },
  };
  emit(work, { kind: 'handSettled', visibility: 'public', reason });
}

import { isCardId, type CardId } from './cards.js';
import type { SeatId } from './deck.js';
import { compareHandRanks, evaluateBest } from './evaluate.js';
import { buildPotLayers, type Contribution } from './pots.js';
import type {
  CorePotAward,
  CoreSettlement,
  RankedSeat,
  SettlementBalance,
  SettlementPlan,
  ShowdownSeat,
} from './settlement-types.js';
const safe = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const seat = (v: unknown): v is SeatId => safe(v) && v < 4;
function invalid(): never {
  throw new RangeError('INVALID_SETTLEMENT_INPUT');
}
export function rankShowdown(
  board: readonly CardId[],
  seats: readonly ShowdownSeat[],
): readonly RankedSeat[] {
  if (
    !Array.isArray(board) ||
    board.length !== 5 ||
    !Array.isArray(seats) ||
    !seats.length ||
    seats.length > 4
  )
    invalid();
  const ids = new Set<SeatId>(),
    all: CardId[] = [];
  for (const card of board) {
    if (!isCardId(card)) invalid();
    all.push(card);
  }
  for (const p of seats) {
    if (
      !p ||
      !seat(p.seatId) ||
      ids.has(p.seatId) ||
      !Array.isArray(p.holeCards) ||
      p.holeCards.length !== 2
    )
      invalid();
    ids.add(p.seatId);
    for (const card of p.holeCards) {
      if (!isCardId(card)) invalid();
      all.push(card);
    }
  }
  if (new Set(all).size !== all.length) invalid();
  return Object.freeze(
    [...seats]
      .sort((a, b) => a.seatId - b.seatId)
      .map((p) => {
        const r = evaluateBest([...board, ...p.holeCards]);
        return Object.freeze({
          seatId: p.seatId,
          rank: Object.freeze({ category: r.category, tieBreak: r.tieBreak }),
        });
      }),
  );
}
export function awardContributions(input: {
  readonly contributions: readonly Contribution[];
  readonly dealerSeatId: SeatId;
  readonly ranks: readonly RankedSeat[];
  readonly reason: 'showdown' | 'allOthersFolded';
}): SettlementPlan {
  if (
    !input ||
    !seat(input.dealerSeatId) ||
    !['showdown', 'allOthersFolded'].includes(input.reason) ||
    !Array.isArray(input.ranks)
  )
    invalid();
  const built = buildPotLayers(input.contributions),
    rankBySeat = new Map<SeatId, RankedSeat['rank']>();
  for (const p of input.ranks) {
    if (
      !p ||
      !seat(p.seatId) ||
      rankBySeat.has(p.seatId) ||
      !input.contributions.some((c) => c.seatId === p.seatId)
    )
      invalid();
    try {
      compareHandRanks(p.rank, p.rank);
    } catch {
      invalid();
    }
    rankBySeat.set(p.seatId, p.rank);
  }
  if (input.reason === 'allOthersFolded') {
    if (input.contributions.filter((p) => !p.folded).length !== 1) invalid();
  } else if (
    input.contributions.some((p) => !p.folded && p.amount > 0 && !rankBySeat.has(p.seatId))
  )
    invalid();
  const pots: CorePotAward[] = built.pots.map((pot) => {
    let winners: SeatId[] = [];
    if (input.reason === 'allOthersFolded') winners = [...pot.eligibleSeatIds];
    else
      for (const id of pot.eligibleSeatIds) {
        const rank = rankBySeat.get(id);
        if (!rank) invalid();
        const comparison = winners.length
          ? compareHandRanks(rank, rankBySeat.get(winners[0]!)!)
          : 1;
        if (comparison > 0) winners = [id];
        else if (comparison === 0) winners.push(id);
      }
    const distance = (s: SeatId) => (s - input.dealerSeatId + 4) % 4 || 4;
    winners.sort((a, b) => distance(a) - distance(b));
    const base = Math.floor(pot.amount / winners.length),
      remainder = pot.amount % winners.length;
    return Object.freeze({
      ...pot,
      winnerSeatIds: Object.freeze(winners),
      allocations: Object.freeze(
        winners.map((seatId, i) =>
          Object.freeze({ seatId, amount: base + (i < remainder ? 1 : 0) }),
        ),
      ),
      winningCategory:
        input.reason === 'allOthersFolded' ? null : rankBySeat.get(winners[0]!)!.category,
    });
  });
  const payoutTotal = pots.reduce((sum, p) => sum + p.amount, 0);
  if (payoutTotal + built.refundTotal !== built.originalContributionTotal)
    throw new RangeError('UNSAFE_SETTLEMENT_TOTAL');
  return Object.freeze({
    reason: input.reason,
    refunds: built.refunds,
    pots: Object.freeze(pots),
    refundTotal: built.refundTotal,
    payoutTotal,
    originalContributionTotal: built.originalContributionTotal,
  });
}
export function settleBalances(input: {
  readonly players: readonly SettlementBalance[];
  readonly dealerSeatId: SeatId;
  readonly ranks: readonly RankedSeat[];
  readonly reason: 'showdown' | 'allOthersFolded';
}): CoreSettlement {
  if (!input || !Array.isArray(input.players)) invalid();
  let total = 0;
  for (const p of input.players) {
    if (
      !p ||
      !safe(p.stack) ||
      !safe(p.amount) ||
      !safe(p.streetCommitted) ||
      p.streetCommitted > p.amount
    )
      invalid();
    total += p.stack + p.amount;
    if (!safe(total)) throw new RangeError('UNSAFE_SETTLEMENT_TOTAL');
  }
  const plan = awardContributions({ ...input, contributions: input.players });
  const finalBalances = Object.freeze(
    [...input.players]
      .sort((a, b) => a.seatId - b.seatId)
      .map((p) =>
        Object.freeze({
          seatId: p.seatId,
          stack:
            p.stack +
            plan.refunds.filter((r) => r.seatId === p.seatId).reduce((s, r) => s + r.amount, 0) +
            plan.pots
              .flatMap((p) => p.allocations)
              .filter((a) => a.seatId === p.seatId)
              .reduce((s, a) => s + a.amount, 0),
          streetCommitted: 0 as const,
          handCommitted: 0 as const,
        }),
      ),
  );
  if (
    finalBalances.reduce((s, p) => s + p.stack, 0) !== total ||
    finalBalances.some((p) => !safe(p.stack))
  )
    throw new RangeError('UNSAFE_SETTLEMENT_TOTAL');
  return Object.freeze({ plan, finalBalances });
}

import { isCardId } from './cards.js';
import { resolvePositions } from './positions.js';
import { getRoundOutcome } from './betting-round.js';
import { handRound } from './hand-betting.js';
import { compareHandRanks, evaluateBest, type EvaluatedHand } from './evaluate.js';
import type { SeatId } from './deck.js';
import type { HandState } from './hand-types.js';
export type HandInvariantCode =
  | 'CHIPS_UNSAFE'
  | 'CHIPS_NOT_CONSERVED'
  | 'CARDS_INVALID'
  | 'ACTOR_INVALID'
  | 'TURN_INVALID'
  | 'PHASE_INVALID'
  | 'SETTLEMENT_INVALID';
export class HandInvariantError extends Error {
  readonly code: HandInvariantCode;
  constructor(code: HandInvariantCode) {
    super(code);
    this.name = 'HandInvariantError';
    this.code = code;
  }
}
function fail(code: HandInvariantCode): never {
  throw new HandInvariantError(code);
}
const safe = (n: unknown): n is number =>
  typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
function hasPrivateKeys(value: unknown, seen = new Set<object>()): boolean {
  if (!value || typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  return Object.entries(value).some(
    ([key, v]) =>
      ['deck', 'burnCards', 'holeCards', 'resumeToken', 'tokenHash'].includes(key) ||
      hasPrivateKeys(v, seen),
  );
}
export function assertHandInvariants(s: HandState): void {
  if (!s || !Array.isArray(s.players) || s.players.length < 2 || s.players.length > 4)
    fail('ACTOR_INVALID');
  const ids = new Set<number>(),
    identities = new Set<string>();
  let total = 0,
    starting = 0;
  if (
    !safe(s.initialChipTotal) ||
    s.initialChipTotal === 0 ||
    ![s.handVersion, s.turnSerial, s.eventSequence].every(safe) ||
    s.handVersion < 1
  )
    fail('CHIPS_UNSAFE');
  for (const p of s.players) {
    if (
      !p ||
      ![0, 1, 2, 3].includes(p.seatId) ||
      ids.has(p.seatId) ||
      typeof p.participantId !== 'string' ||
      !p.participantId.trim() ||
      identities.has(p.participantId)
    )
      fail('ACTOR_INVALID');
    ids.add(p.seatId);
    identities.add(p.participantId);
    if (
      ![p.stack, p.streetCommitted, p.handCommitted, p.startingStack].every(safe) ||
      p.startingStack === 0 ||
      p.streetCommitted > p.handCommitted
    )
      fail('CHIPS_UNSAFE');
    total += p.stack + p.handCommitted;
    starting += p.startingStack;
    if (!safe(total) || !safe(starting)) fail('CHIPS_UNSAFE');
    if (typeof p.folded !== 'boolean' || typeof p.allIn !== 'boolean' || (p.allIn && p.stack !== 0))
      fail('ACTOR_INVALID');
  }
  if (total !== s.initialChipTotal || starting !== s.initialChipTotal) fail('CHIPS_NOT_CONSERVED');
  if (
    !s.deck ||
    !Array.isArray(s.deck.cards) ||
    s.deck.cards.length !== 52 ||
    !safe(s.deck.cursor) ||
    s.deck.cursor > 52 ||
    new Set(s.deck.cards).size !== 52 ||
    Array.from(s.deck.cards).some((c) => !isCardId(c)) ||
    !Array.isArray(s.board) ||
    !Array.isArray(s.burnCards)
  )
    fail('CARDS_INVALID');
  const used = [...s.board, ...s.burnCards];
  for (const p of s.players) {
    if (!Array.isArray(p.holeCards) || p.holeCards.length !== 2) fail('CARDS_INVALID');
    used.push(...p.holeCards);
  }
  if (
    used.some((c) => !isCardId(c)) ||
    new Set(used).size !== used.length ||
    used.length !== s.deck.cursor ||
    used.some((c) => !s.deck.cards.slice(0, s.deck.cursor).includes(c))
  )
    fail('CARDS_INVALID');
  const boardBurn = new Map([
    [0, 0],
    [3, 1],
    [4, 2],
    [5, 3],
  ]);
  if (boardBurn.get(s.board.length) !== s.burnCards.length) fail('PHASE_INVALID');
  try {
    const p = resolvePositions(
      s.players.map((p) => p.seatId),
      s.positions.dealerSeatId,
    );
    for (const k of [
      'dealerSeatId',
      'smallBlindSeatId',
      'bigBlindSeatId',
      'dealOrder',
      'preflopOrder',
      'postflopOrder',
    ] as const)
      if (JSON.stringify(p[k]) !== JSON.stringify(s.positions[k])) fail('PHASE_INVALID');
  } catch {
    fail('PHASE_INVALID');
  }
  if (typeof s.handId !== 'string' || !s.handId.trim()) fail('TURN_INVALID');
  if (s.phase !== 'settled') {
    const counts = { preflop: 0, flop: 3, turn: 4, river: 5 };
    if (!(s.phase in counts) || s.phase === 'showdown' || s.board.length !== counts[s.phase])
      fail('PHASE_INVALID');
    if (s.result !== null || s.settlementCount !== 0) fail('SETTLEMENT_INVALID');
    try {
      if (getRoundOutcome(handRound(s)) !== 'continue') fail('ACTOR_INVALID');
    } catch {
      fail('ACTOR_INVALID');
    }
    if (s.turnSerial < 1 || s.turnId !== s.handId + ':turn:' + s.turnSerial) fail('TURN_INVALID');
    return;
  }
  const r = s.result;
  if (
    !r ||
    s.settlementCount !== 1 ||
    s.betting !== null ||
    s.players.some((p) => p.handCommitted !== 0 || p.streetCommitted !== 0)
  )
    fail('SETTLEMENT_INVALID');
  if (s.turnId !== null) fail('TURN_INVALID');
  if (
    hasPrivateKeys(r) ||
    r.reason !== r.settlement.plan.reason ||
    !['showdown', 'allOthersFolded'].includes(r.reason)
  )
    fail('SETTLEMENT_INVALID');
  if (
    r.settlement.finalBalances.length !== s.players.length ||
    new Set(r.settlement.finalBalances.map((p) => p.seatId)).size !== s.players.length ||
    r.settlement.finalBalances.some(
      (b) =>
        !s.players.some((p) => p.seatId === b.seatId && p.stack === b.stack) ||
        b.handCommitted !== 0 ||
        b.streetCommitted !== 0,
    )
  )
    fail('SETTLEMENT_INVALID');
  const alive = s.players.filter((p) => !p.folded),
    publicCards = r.showdownCards;
  if (
    r.reason === 'allOthersFolded'
      ? alive.length !== 1 || publicCards.length !== 0
      : s.board.length !== 5 ||
        publicCards.length !== alive.length ||
        new Set(publicCards.map((p) => p.seatId)).size !== alive.length ||
        publicCards.some(
          (p) =>
            !alive.some(
              (a) =>
                a.seatId === p.seatId && JSON.stringify(a.holeCards) === JSON.stringify(p.cards),
            ),
        )
  )
    fail('SETTLEMENT_INVALID');
  const ranks = new Map<SeatId, EvaluatedHand>(
    r.reason === 'showdown'
      ? alive.map((p) => [p.seatId, evaluateBest([...s.board, ...p.holeCards])])
      : [],
  );
  let payoutTotal = 0,
    lower = 0;
  const committed = new Map<SeatId, number>(),
    awarded = new Map<SeatId, number>();
  for (const pot of r.settlement.plan.pots) {
    if (
      pot.lowerExclusive !== lower ||
      pot.potId !== `pot:${pot.lowerExclusive}:${pot.upperInclusive}` ||
      new Set(pot.contributorSeatIds).size !== pot.contributorSeatIds.length ||
      pot.contributorSeatIds.some((id) => !ids.has(id)) ||
      JSON.stringify(pot.eligibleSeatIds) !==
        JSON.stringify(pot.contributorSeatIds.filter((id) => alive.some((p) => p.seatId === id)))
    )
      fail('SETTLEMENT_INVALID');
    if (
      !safe(pot.amount) ||
      pot.amount === 0 ||
      !safe(pot.lowerExclusive) ||
      !safe(pot.upperInclusive) ||
      pot.upperInclusive <= pot.lowerExclusive ||
      pot.amount !== (pot.upperInclusive - pot.lowerExclusive) * pot.contributorSeatIds.length ||
      !pot.eligibleSeatIds.length ||
      !pot.winnerSeatIds.length ||
      new Set(pot.eligibleSeatIds).size !== pot.eligibleSeatIds.length ||
      new Set(pot.winnerSeatIds).size !== pot.winnerSeatIds.length ||
      pot.eligibleSeatIds.some(
        (id) => !pot.contributorSeatIds.includes(id) || !alive.some((p) => p.seatId === id),
      ) ||
      pot.winnerSeatIds.some((id) => !pot.eligibleSeatIds.includes(id)) ||
      pot.allocations.length !== pot.winnerSeatIds.length ||
      new Set(pot.allocations.map((a) => a.seatId)).size !== pot.allocations.length ||
      pot.allocations.some((a) => !safe(a.amount) || !pot.winnerSeatIds.includes(a.seatId)) ||
      pot.allocations.reduce((sum, a) => sum + a.amount, 0) !== pot.amount
    )
      fail('SETTLEMENT_INVALID');
    if (r.reason === 'allOthersFolded') {
      if (pot.winningCategory !== null || pot.winnerSeatIds.some((id) => id !== alive[0]!.seatId))
        fail('SETTLEMENT_INVALID');
    } else {
      const best = ranks.get(pot.winnerSeatIds[0]!);
      if (
        !best ||
        pot.winningCategory !== best.category ||
        pot.eligibleSeatIds.some((id) => {
          const rank = ranks.get(id);
          return (
            !rank ||
            compareHandRanks(rank, best) > 0 ||
            (compareHandRanks(rank, best) === 0) !== pot.winnerSeatIds.includes(id)
          );
        })
      )
        fail('SETTLEMENT_INVALID');
    }
    const distance = (id: SeatId) => (id - s.positions.dealerSeatId + 4) % 4 || 4;
    const priority = [...pot.winnerSeatIds].sort((a, b) => distance(a) - distance(b));
    const base = Math.floor(pot.amount / priority.length),
      remainder = pot.amount % priority.length;
    if (
      JSON.stringify(priority) !== JSON.stringify(pot.winnerSeatIds) ||
      priority.some(
        (id, i) =>
          pot.allocations.find((a) => a.seatId === id)?.amount !== base + (i < remainder ? 1 : 0),
      )
    )
      fail('SETTLEMENT_INVALID');
    for (const id of pot.contributorSeatIds)
      committed.set(id, (committed.get(id) ?? 0) + pot.upperInclusive - pot.lowerExclusive);
    for (const a of pot.allocations) awarded.set(a.seatId, (awarded.get(a.seatId) ?? 0) + a.amount);
    lower = pot.upperInclusive;
    payoutTotal += pot.amount;
    if (!safe(payoutTotal)) fail('SETTLEMENT_INVALID');
  }
  // Refunds cancel the unmatched contribution, so adjusted layer contributions
  // independently reconstruct each final balance without adding a refund twice.
  if (
    s.players.some(
      (p) =>
        p.stack !== p.startingStack - (committed.get(p.seatId) ?? 0) + (awarded.get(p.seatId) ?? 0),
    )
  )
    fail('SETTLEMENT_INVALID');
  const refundTotal = r.settlement.plan.refunds.reduce((sum, p) => sum + p.amount, 0);
  if (
    r.refunds.some((p) => !safe(p.amount) || p.amount === 0 || !ids.has(p.seatId)) ||
    JSON.stringify(r.refunds) !== JSON.stringify(s.issuedRefunds) ||
    !safe(refundTotal) ||
    refundTotal !== r.settlement.plan.refundTotal ||
    payoutTotal !== r.settlement.plan.payoutTotal ||
    payoutTotal + refundTotal !== r.settlement.plan.originalContributionTotal
  )
    fail('SETTLEMENT_INVALID');
}

import type { CardId } from '@orbit/protocol';
import type { BotObservation, UnknownSample } from './bot-types.js';
import type { PolicyRandom } from './policy-basic.js';
import { createDeck, isCardId } from '@orbit/poker-core';
export function unknownCards(o: BotObservation): CardId[] {
  const expected = { preflop: 0, flop: 3, turn: 4, river: 5 }[o.phase];
  if (
    expected === undefined ||
    !Array.isArray(o.holeCards) ||
    o.holeCards.length !== 2 ||
    !Array.isArray(o.board) ||
    o.board.length !== expected
  )
    throw Error('INVALID_EQUITY_KNOWN_CARDS');
  const known = [...o.holeCards, ...o.board];
  if (known.some((c) => !isCardId(c)) || new Set(known).size !== known.length)
    throw Error('INVALID_EQUITY_KNOWN_CARDS');
  return createDeck().filter((c) => !known.includes(c));
}
export function validateEquityObservation(o: BotObservation) {
  const pool = unknownCards(o),
    safe = (v: number) => Number.isSafeInteger(v) && v >= 0;
  if (
    !Array.isArray(o.players) ||
    o.players.length < 2 ||
    o.players.length > 4 ||
    new Set(o.players.map((p) => p.seatId)).size !== o.players.length ||
    new Set(o.players.map((p) => p.participantId)).size !== o.players.length ||
    !safe(o.legalActions.callAmount)
  )
    throw Error('INVALID_EQUITY_PLAYERS');
  for (const p of o.players)
    if (
      !Number.isInteger(p.seatId) ||
      p.seatId < 0 ||
      p.seatId > 3 ||
      !safe(p.stack) ||
      !safe(p.handCommitted) ||
      !safe(p.streetCommitted) ||
      p.streetCommitted > p.handCommitted ||
      typeof p.folded !== 'boolean' ||
      typeof p.allIn !== 'boolean'
    )
      throw Error('INVALID_EQUITY_PLAYER');
  const own = o.players.find((p) => p.participantId === o.participantId);
  if (
    !own ||
    own.seatId !== o.seatId ||
    own.folded ||
    !safe(o.potTotal) ||
    o.players.reduce((n, p) => n + p.handCommitted, 0) !== o.potTotal ||
    !o.players.some((p) => p.seatId === o.dealerSeatId)
  )
    throw Error('INVALID_EQUITY_SELF');
  const cost = Math.min(o.legalActions.callAmount, own.stack);
  if (!safe(o.potTotal + cost)) throw Error('UNSAFE_EQUITY_TOTAL');
  return { pool, own, cost };
}
export function sampleFromPool(
  o: BotObservation,
  pool: readonly CardId[],
  random: PolicyRandom,
): UnknownSample {
  const remaining = [...pool],
    opponents = o.players.filter((p) => !p.folded && p.participantId !== o.participantId),
    count = opponents.length * 2 + 5 - o.board.length;
  for (let i = 0; i < count; i++) {
    const n = random.next();
    if (!Number.isFinite(n) || n < 0 || n >= 1) throw Error('INVALID_POLICY_RANDOM');
    const j = i + Math.floor(n * (remaining.length - i));
    [remaining[i], remaining[j]] = [remaining[j]!, remaining[i]!];
  }
  let cursor = 0;
  return {
    opponents: opponents.map((p) => ({
      seatId: p.seatId,
      holeCards: [remaining[cursor++]!, remaining[cursor++]!],
    })),
    board: [...o.board, ...remaining.slice(cursor, cursor + 5 - o.board.length)],
  };
}
export function sampleUnknown(o: BotObservation, random: PolicyRandom): UnknownSample {
  const { pool } = validateEquityObservation(o);
  return sampleFromPool(o, pool, random);
}

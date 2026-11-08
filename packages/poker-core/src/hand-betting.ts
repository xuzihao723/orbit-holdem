import type { BettingRound } from './betting-types.js';
import type { HandState } from './hand-types.js';
export function handRound(state: HandState): BettingRound {
  if (!state.betting || state.phase !== state.betting.street) throw new Error('INVALID_HAND_STATE');
  return { ...state.betting, players: state.players };
}
export function mergeHandRound(state: HandState, round: BettingRound): HandState {
  const { players, ...betting } = round;
  if (
    players.length !== state.players.length ||
    players.some((p) => !state.players.some((h) => h.seatId === p.seatId))
  )
    throw new Error('INVALID_HAND_STATE');
  return {
    ...state,
    phase: round.street,
    betting,
    players: state.players.map((p) => ({ ...p, ...players.find((b) => b.seatId === p.seatId)! })),
  };
}

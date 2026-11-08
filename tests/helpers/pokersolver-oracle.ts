import solver, { type Hand } from 'pokersolver';
import type { CardId } from '../../packages/poker-core/src/index.js';
export function oracleSolve(cards: readonly CardId[]): Hand {
  return solver.Hand.solve(
    cards.map((card) => card.slice(0, -1).replace('10', 'T') + card.slice(-1).toLowerCase()),
    'standard',
    false,
  );
}
export function oracleCompare(a: Hand, b: Hand): -1 | 0 | 1 {
  const winners = solver.Hand.winners([a, b]);
  if (winners.length === 2) return 0;
  if (winners.length !== 1) throw new Error('ORACLE_NO_WINNER');
  return winners[0] === a ? 1 : -1;
}

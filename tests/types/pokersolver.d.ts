declare module 'pokersolver' {
  export class Hand {
    readonly rank: number;
    static solve(cards: string[], game: 'standard', canDisqualify: false): Hand;
    static winners(hands: Hand[]): Hand[];
  }
  const solver: { Hand: typeof Hand };
  export default solver;
}

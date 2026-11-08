import { expect, it } from 'vitest';
import { fixtures } from '../../apps/web/src/dev/graybox-fixtures';
it('keeps twelve unique preview scenarios and legal public room seats', () => {
  expect(fixtures).toHaveLength(12);
  expect(new Set(fixtures.map((f) => f.id)).size).toBe(12);
  const counter = new Intl.Segmenter('zh', { granularity: 'grapheme' });
  for (const fixture of fixtures) {
    const room = fixture.page === 'table' ? fixture.table.room : fixture.room;
    expect(room.seats.map((s) => s.seatId)).toEqual([0, 1, 2, 3]);
    const occupied = room.seats.filter((s) => s.occupant !== null);
    expect(occupied.length).toBeLessThanOrEqual(room.capacity);
    expect(room.seats.filter((s) => s.availability === 'open').length).toBe(
      room.capacity - occupied.length,
    );
    for (const seat of occupied) {
      expect(seat.availability).toBe('occupied');
      expect([...counter.segment(seat.occupant!.nickname)].length).toBeLessThanOrEqual(12);
    }
  }
});
it('conserves fixture chips and keeps pot breakdown aligned with public contributions', () => {
  for (const fixture of fixtures)
    if (fixture.page === 'table') {
      const { hand, room, self } = fixture.table;
      expect(hand.players.reduce((sum, p) => sum + p.handCommitted, 0)).toBe(hand.potTotal);
      if (hand.pots.length > 0)
        expect(hand.pots.reduce((sum, p) => sum + p.amount, 0)).toBe(hand.potTotal);
      for (const player of hand.players) {
        expect(player.stack + player.handCommitted).toBe(2000);
        expect(room.seats.find((s) => s.seatId === player.seatId)?.occupant?.stack).toBe(
          player.stack,
        );
      }
      if (self) expect(hand.players.some((p) => p.participantId === self.participantId)).toBe(true);
      for (const id of [
        hand.dealerSeatId,
        hand.smallBlindSeatId,
        hand.bigBlindSeatId,
        hand.actorSeatId,
      ]) {
        expect(hand.players.some((p) => p.seatId === id)).toBe(true);
      }
    }
});
it('stores no hidden opponent cards, credentials, or deck order in previews', () => {
  for (const fixture of fixtures) {
    const serialized = JSON.stringify(fixture);
    expect(serialized).not.toMatch(/resumeToken|sessionId|deckOrder|deckSeed/);
    if (fixture.page === 'table') {
      expect(JSON.stringify(fixture.table.hand)).not.toContain('holeCards');
      expect(JSON.stringify(fixture.table.room)).not.toContain('holeCards');
      const own = fixture.table.self?.holeCards ?? [];
      const cards = [...fixture.table.hand.board, ...own];
      expect(new Set(cards).size).toBe(cards.length);
    }
  }
});

it('does not grant chips to a new occupant waiting for the next hand', () => {
  const fixture = fixtures.find((f) => f.id === 'table-next-hand');
  if (fixture?.page !== 'table') throw new Error('Missing next-hand fixture');
  expect(fixture.table.room.seats.find((s) => s.seatId === 0)?.occupant?.stack).toBe(0);
  expect(fixture.table.self).toBeNull();
  expect(fixture.table.hand.players.some((p) => p.seatId === 0)).toBe(false);
});
it('leaves unfinalized all-in contributions unallocated until opponents respond', () => {
  const fixture = fixtures.find((f) => f.id === 'table-all-in');
  if (fixture?.page !== 'table') throw new Error('Missing all-in fixture');
  expect(fixture.table.hand.potTotal).toBe(2300);
  expect(fixture.table.hand.pots).toEqual([]);
});

it('does not allocate the unanswered big blind into a shared preflop pot', () => {
  const fixture = fixtures.find((f) => f.id === 'table-preflop');
  if (fixture?.page !== 'table') throw new Error('Missing preflop fixture');
  expect(fixture.table.hand.potTotal).toBe(30);
  expect(fixture.table.hand.pots).toEqual([]);
});

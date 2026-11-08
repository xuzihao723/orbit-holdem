import { expect, it } from 'vitest';
import { RoomQueue } from '../../apps/server/src/game/room-queue.js';
it('reserves both identity and room order before waiting on a blocked identity', async () => {
  const q = new RoomQueue(),
    seen: string[] = [];
  expect(q.runKeys).toBeTypeOf('function');
  let release!: () => void;
  const previous = q.runKeys(['session:A'], () => new Promise<void>((r) => (release = r)));
  await Promise.resolve();
  const user = q.runKeys(['session:A', 'room:R'], () => {
    seen.push('user');
  });
  const timer = q.runKeys(['room:R'], () => {
    seen.push('timer');
  });
  await q.runKeys(['room:other'], () => seen.push('other'));
  expect(seen).toEqual(['other']);
  release();
  await Promise.all([previous, user, timer]);
  expect(seen).toEqual(['other', 'user', 'timer']);
  await q.close();
});
it('orders crossed identity/room dependencies without acquiring locks recursively', async () => {
  const q = new RoomQueue();
  expect(q.runKeys).toBeTypeOf('function');
  const seen: string[] = [];
  await Promise.all([
    q.runKeys(['session:A', 'room:X'], () => seen.push('AX')),
    q.runKeys(['session:B', 'room:Y'], () => seen.push('BY')),
    q.runKeys(['session:A', 'room:Y'], () => seen.push('AY')),
    q.runKeys(['session:B', 'room:X'], () => seen.push('BX')),
  ]);
  expect(seen.indexOf('AY')).toBeGreaterThan(seen.indexOf('AX'));
  expect(seen.indexOf('BX')).toBeGreaterThan(seen.indexOf('BY'));
  await q.close();
});
it('serializes the same key while allowing independent rooms to progress', async () => {
  const q = new RoomQueue(),
    seen: string[] = [];
  let release!: () => void;
  const first = q.run('r1', async () => {
    seen.push('a');
    await new Promise<void>((r) => (release = r));
    seen.push('b');
  });
  await Promise.resolve();
  const next = q.run('r1', () => {
    seen.push('c');
  });
  await q.run('r2', () => {
    seen.push('d');
  });
  expect(seen).toEqual(['a', 'd']);
  release();
  await Promise.all([first, next]);
  expect(seen).toEqual(['a', 'd', 'b', 'c']);
  await q.close();
});
it('recovers from rejection and drains accepted tasks before closing', async () => {
  const q = new RoomQueue(),
    first = q.run('r', () => {
      throw new Error('failed');
    });
  await expect(first).rejects.toThrow('failed');
  const next = q.run('r', () => 42),
    closing = q.close();
  await expect(q.run('r', () => 0)).rejects.toThrow();
  expect(await next).toBe(42);
  await closing;
  await q.close();
});

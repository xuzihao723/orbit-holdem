import { expect, test } from 'vitest';
import { QueryStore } from '../../apps/web/src/network/query-store.js';
test('a late record never overwrites another record or an invalidated identity', async () => {
  const store = new QueryStore<string>();
  let resolveA!: (v: string) => void;
  const a = store.load(
    'session:epoch:A',
    () =>
      new Promise<string>((r) => {
        resolveA = r;
      }),
  );
  await store.load('session:epoch:B', async () => 'B');
  resolveA('private A');
  await a;
  expect(store.snapshot.data).toBe('B');
  let resolveC!: (v: string) => void;
  const c = store.load(
    'session:epoch:C',
    () =>
      new Promise<string>((r) => {
        resolveC = r;
      }),
  );
  store.clear();
  resolveC('private C');
  await c;
  expect(store.snapshot.data).toBe(null);
});

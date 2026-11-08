import { expect, it } from 'vitest';
import { RateLimiter } from '../../apps/server/src/transport/rate-limit.js';
it('shares scopes atomically and reopens the exact sliding-window boundary', () => {
  const r = new RateLimiter(10),
    scopes = [
      { key: 'socket:a', limit: 10, windowMs: 1000 },
      { key: 'session:a', limit: 10, windowMs: 1000 },
    ];
  for (let i = 0; i < 10; i++) expect(r.take(scopes, 100)).toBeNull();
  expect(r.take(scopes, 100)).toBe(1000);
  expect(r.take([{ ...scopes[0]!, key: 'socket:b' }, scopes[1]!], 600)).toBe(500);
  expect(r.take([{ key: 'socket:b', limit: 10, windowMs: 1000 }], 600)).toBeNull();
  expect(r.take(scopes, 1100)).toBeNull();
});
it('bounds live buckets without evicting an active identity and cleans expired state', () => {
  const r = new RateLimiter(2);
  expect(r.take([{ key: 'a', limit: 1, windowMs: 1000 }], 0)).toBeNull();
  expect(r.take([{ key: 'b', limit: 1, windowMs: 1000 }], 0)).toBeNull();
  expect(r.take([{ key: 'c', limit: 1, windowMs: 1000 }], 1)).toBe(999);
  expect(r.take([{ key: 'a', limit: 1, windowMs: 1000 }], 1)).toBe(999);
  expect(r.take([{ key: 'c', limit: 1, windowMs: 1000 }], 1000)).toBeNull();
  r.clearPrefix('c');
  expect(r.take([{ key: 'd', limit: 1, windowMs: 1000 }], 1000)).toBeNull();
  r.close();
  expect(() => r.take([], 1000)).toThrow();
});
it('rejects invalid clock, configuration, duplicate or incompatible scope definitions', () => {
  expect(() => new RateLimiter(0)).toThrow();
  const r = new RateLimiter();
  for (const now of [NaN, -1, Infinity]) expect(() => r.take([], now)).toThrow();
  expect(() => r.take([{ key: 'x', limit: 0, windowMs: 10 }], 0)).toThrow();
  r.take([{ key: 'x', limit: 1, windowMs: 10 }], 100);
  expect(() => r.take([{ key: 'x', limit: 2, windowMs: 10 }], 100)).toThrow();
  expect(() => r.take([], 99)).toThrow();
  expect(() =>
    r.take(
      [
        { key: 'a', limit: 1, windowMs: 10 },
        { key: 'a', limit: 1, windowMs: 10 },
      ],
      100,
    ),
  ).toThrow();
});

it('waits for whole buckets and enough slots, and rejects impossible scope capacity', () => {
  const r = new RateLimiter(2);
  const a = { key: 'a', limit: 3, windowMs: 1000 },
    b = { key: 'b', limit: 3, windowMs: 1000 };
  r.take([a], 0);
  r.take([a], 500);
  r.take([b], 600);
  expect(
    r.take(
      [
        { key: 'c', limit: 1, windowMs: 1000 },
        { key: 'd', limit: 1, windowMs: 1000 },
      ],
      700,
    ),
  ).toBe(900);
  expect(
    r.take(
      [
        { key: 'c', limit: 1, windowMs: 1000 },
        { key: 'd', limit: 1, windowMs: 1000 },
      ],
      1600,
    ),
  ).toBeNull();
  expect(() => new RateLimiter(1).take([a, b], 0)).toThrow();
});

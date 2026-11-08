import { expect, it } from 'vitest';
import { ServerTimeClock } from '../../apps/web/src/network/server-clock.js';
it('calibrates display time without resetting a fixed server deadline', () => {
  const c = new ServerTimeClock();
  c.observe(10000, 1000);
  expect(c.remainingMs(40000, 6000)).toBe(25000);
  c.observe(15000, 6000);
  expect(c.remainingMs(40000, 6000)).toBe(25000);
  expect(c.remainingMs(40000, 50000)).toBe(0);
  expect(c.remainingMs(null, 6000)).toBeNull();
});
it('ignores older calibration and rejects nonfinite values', () => {
  const c = new ServerTimeClock();
  c.observe(10000, 1000);
  c.observe(9000, 2000);
  expect(c.remainingMs(40000, 3000)).toBe(28000);
  c.observe(Infinity, 4000);
  expect(c.remainingMs(40000, 3000)).toBe(28000);
});

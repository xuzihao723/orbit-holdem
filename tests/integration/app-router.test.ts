import { expect, it } from 'vitest';
import { accountReturn, parseRoute, RouterStore } from '../../apps/web/src/app/router.js';
it('keeps a room invitation and rejects unsafe account return paths after normalization', () => {
  expect(accountReturn('/play?mode=join&room=ABC234')).toBe('/play?mode=join&room=ABC234');
  for (const path of [
    '//elsewhere.example',
    '//[',
    '/x/..//elsewhere.example',
    '/\n/elsewhere.example',
    '/\\elsewhere.example',
  ])
    expect(accountReturn(path)).toBe('/');
});
it('parses supported routes and rejects unknown or ambiguous codes', () => {
  expect(parseRoute('/play?mode=solo').kind).toBe('setup');
  expect(parseRoute('/room/ABC234')).toEqual({ kind: 'room', code: 'ABC234' });
  expect(parseRoute('/table/ABC234')).toEqual({ kind: 'table', code: 'ABC234' });
  expect(parseRoute('/history').kind).toBe('history');
  expect(parseRoute('/history/test-hand')).toEqual({ kind: 'replay', handId: 'test-hand' });
  expect(parseRoute('/room/IIIIII').kind).toBe('missing');
});
it('notifies on history changes and removes subscriptions', () => {
  const target = new EventTarget(),
    location = { pathname: '/', search: '' },
    history = {
      pushState: (_a: unknown, _b: string, path: string | URL | null | undefined) => {
        const u = new URL(String(path), 'http://local');
        location.pathname = u.pathname;
        location.search = u.search;
      },
    };
  const r = new RouterStore({
    location,
    history,
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
  });
  let n = 0;
  const remove = r.subscribe(() => n++);
  r.navigate('/rules');
  expect(r.snapshot()).toBe('/rules');
  expect(n).toBe(1);
  remove();
  r.navigate('/');
  expect(n).toBe(1);
  expect(() => r.navigate('//other')).toThrow();
});

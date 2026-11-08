export const ROOM_CODE = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/;
export type AppRoute =
  | { kind: 'home' | 'rules' | 'missing' }
  | { kind: 'login' | 'register' | 'reset-password' | 'account' }
  | { kind: 'history' }
  | { kind: 'replay'; handId: string }
  | { kind: 'setup'; mode: 'solo' | 'create' | 'join'; code: string }
  | { kind: 'room' | 'table'; code: string };
export function parseRoute(path: string): AppRoute {
  const u = new URL(path, 'http://orbit.local');
  if (u.pathname === '/') return { kind: 'home' };
  if (u.pathname === '/rules') return { kind: 'rules' };
  if (u.pathname === '/login') return { kind: 'login' };
  if (u.pathname === '/register') return { kind: 'register' };
  if (u.pathname === '/reset-password') return { kind: 'reset-password' };
  if (u.pathname === '/account') return { kind: 'account' };
  if (u.pathname === '/history') return { kind: 'history' };
  const history = /^\/history\/([A-Za-z0-9:_-]{1,128})$/.exec(u.pathname);
  if (history) return { kind: 'replay', handId: history[1]! };
  if (u.pathname === '/play') {
    const mode = u.searchParams.get('mode');
    if (mode === 'solo' || mode === 'create' || mode === 'join')
      return { kind: 'setup', mode, code: (u.searchParams.get('room') ?? '').toUpperCase() };
  }
  const m = /^\/(room|table)\/([^/]+)$/.exec(u.pathname);
  if (m && ROOM_CODE.test(m[2]!)) return { kind: m[1] as 'room' | 'table', code: m[2]! };
  return { kind: 'missing' };
}
export function accountReturn(value: string | null): string {
  if (!value?.startsWith('/') || value.startsWith('//') || /[\\\p{Cc}]/u.test(value)) return '/';
  const base = 'http://orbit.local';
  const target = new URL(value, base);
  if (target.origin !== base || target.pathname.startsWith('//')) return '/';
  const route = parseRoute(target.pathname + target.search);
  return ['home', 'setup', 'room', 'table', 'history', 'replay'].includes(route.kind)
    ? target.pathname + target.search
    : '/';
}
interface HistoryPort {
  location: { pathname: string; search: string };
  history: { pushState(data: unknown, unused: string, url?: string | URL | null): void };
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
  dispatchEvent(event: Event): boolean;
}
export class RouterStore {
  constructor(private port: HistoryPort = window) {}
  snapshot = () => this.port.location.pathname + this.port.location.search;
  subscribe = (listener: () => void) => {
    this.port.addEventListener('popstate', listener);
    return () => this.port.removeEventListener('popstate', listener);
  };
  navigate = (path: string) => {
    if (!path.startsWith('/') || path.startsWith('//')) throw Error('INTERNAL_ROUTE_ONLY');
    this.port.history.pushState(null, '', path);
    this.port.dispatchEvent(new Event('popstate'));
  };
}

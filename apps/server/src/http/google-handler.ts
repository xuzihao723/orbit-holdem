import { createHash, randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { GoogleSignIn } from '../auth/google.js';
import {
  authCookie,
  cookieHash,
  digest,
  isToken,
  loginTtl,
  randomToken,
  accountCookieName,
} from '../auth/session-cookie.js';
import type { PokerDatabase } from '../persistence/db.js';

function returnPath(value: string | null, origin: string) {
  if (
    !value?.startsWith('/') ||
    value.startsWith('//') ||
    /[\\\p{Cc}]/u.test(value) ||
    value.length > 1024
  )
    return '/';
  const url = new URL(value, origin);
  if (
    url.origin !== origin ||
    !/^(?:\/|\/play|\/history(?:\/[A-Za-z0-9:_-]{1,128})?|\/(?:room|table)\/[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6})$/.test(
      url.pathname,
    )
  )
    return '/';
  return url.pathname + url.search;
}

export function createGoogleHandler(
  repo: PokerDatabase['accounts'],
  provider: GoogleSignIn,
  origin: string,
  now: () => number,
  refreshControl: (sessionId: string) => void,
) {
  const secure = origin.startsWith('https:');
  const flowName = secure ? '__Host-orbit-google' : 'orbit-google';
  const loginName = accountCookieName(secure);
  const flowTtl = 300_000;
  return async (req: IncomingMessage, res: ServerResponse, path: string, ip: string) => {
    const url = new URL(req.url ?? '/', origin);
    const redirect = (location: string) => {
      res.writeHead(303, { Location: location, 'Referrer-Policy': 'no-referrer' });
      res.end();
    };
    const reject = (status: number) => {
      res.writeHead(status);
      res.end();
    };
    const time = now();
    if (path === 'google/start') {
      if (req.method !== 'POST') return reject(405);
      if (req.headers.origin !== origin) return reject(403);
      if (!repo.allow('google-start:' + digest(ip), time, 60_000, 20)) return reject(429);
      const state = randomToken();
      const browser = randomToken();
      const verifier = randomToken();
      const nonce = randomToken();
      const challenge = createHash('sha256').update(verifier).digest('base64url');
      repo.startGoogleFlow({
        state: digest(state),
        browser: digest(browser),
        verifier,
        nonce,
        next: returnPath(url.searchParams.get('next'), origin),
        now: time,
        expires: time + flowTtl,
      });
      res.setHeader('Set-Cookie', authCookie(flowName, browser, flowTtl / 1000, secure));
      return redirect(provider.authorizationUrl({ state, nonce, challenge }));
    }
    if (path !== 'google/callback') return reject(404);
    if (req.method !== 'GET') return reject(405);
    const state = url.searchParams.get('state');
    const browser = cookieHash(req.headers.cookie, flowName);
    const flow = isToken(state) && browser && repo.takeGoogleFlow(digest(state), browser, time);
    if (!flow) return redirect('/login?google=failed');
    const flowCookie = authCookie(flowName, '', 0, secure);
    res.setHeader('Set-Cookie', flowCookie);
    const finish = (result: string) =>
      redirect('/login?' + new URLSearchParams({ google: result, next: flow.return_path }));
    if (url.searchParams.get('error') === 'access_denied') return finish('cancelled');
    const code = url.searchParams.get('code');
    if (!code || code.length > 2048 || url.searchParams.has('error')) return finish('failed');
    try {
      const profile = await provider.identity(code, flow.verifier, flow.nonce);
      const previousLogin = cookieHash(req.headers.cookie, loginName);
      const issuedAt = now();
      const previous = previousLogin && repo.login(previousLogin, issuedAt);
      const token = randomToken();
      repo.signInGoogle({
        ...profile,
        sessionId: randomUUID(),
        disabledGuestHash: digest(randomToken()),
        loginHash: digest(token),
        previousLogin,
        expires: issuedAt + loginTtl,
        now: issuedAt,
      });
      if (previous) refreshControl(previous.session_id);
      res.setHeader('Set-Cookie', [
        flowCookie,
        authCookie(loginName, token, loginTtl / 1000, secure),
      ]);
      return redirect(flow.return_path);
    } catch {
      return finish('failed');
    }
  };
}

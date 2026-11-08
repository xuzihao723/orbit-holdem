import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isIP } from 'node:net';
import type { ApplicationRuntime } from '../application-runtime.js';
import type { AuthOptions } from '../auth/delivery.js';
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
import { createGoogleHandler } from './google-handler.js';
import { acceptablePassword, AuthBusy, checkPassword, hashPassword } from '../auth/password.js';
import { normalizeNickname, SessionPayloadError } from '../sessions/input.js';
import { hashResumeToken, InvalidResumeToken } from '../sessions/token.js';

const codeTtl = 300_000;
export function authClientAddress(
  remote: string | undefined,
  forwarded: string | string[] | undefined,
  key: string | string[] | undefined,
  expected: string | undefined,
): string {
  const trusted =
    expected &&
    /^[a-f0-9]{64}$/.test(expected) &&
    typeof key === 'string' &&
    /^[a-f0-9]{64}$/.test(key) &&
    timingSafeEqual(Buffer.from(key), Buffer.from(expected));
  const address = trusted && typeof forwarded === 'string' && isIP(forwarded) ? forwarded : remote;
  return address?.replace(/^::ffff:/, '') ?? 'unknown';
}
const emailAddress = (value: unknown) => {
  if (typeof value !== 'string') return null;
  const email = value.trim();
  if (
    email.length > 254 ||
    !/^[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,63}$/.test(
      email,
    )
  )
    return null;
  const at = email.lastIndexOf('@');
  const local = email.slice(0, at);
  const domain = email.slice(at + 1).toLowerCase();
  if (
    local.length > 64 ||
    local.startsWith('.') ||
    local.endsWith('.') ||
    local.includes('..') ||
    domain.split('.').some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  )
    return null;
  return local + '@' + domain;
};
class InputError extends Error {}
async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (req.headers['content-type']?.split(';')[0]?.trim() !== 'application/json')
    throw new InputError();
  const parts: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += part.length;
    if (bytes > 4096) {
      req.resume();
      throw new InputError();
    }
    parts.push(part);
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(parts).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InputError();
    return value as Record<string, unknown>;
  } catch {
    throw new InputError();
  }
}

export function createAuthHandler(
  app: ApplicationRuntime,
  options: AuthOptions | undefined,
  google: GoogleSignIn | undefined,
  origin: string,
  now: () => number,
  refreshControl: (sessionId: string) => void,
) {
  if (options && options.codeKey.length !== 32) throw Error('INVALID_AUTH_CODE_KEY');
  const secure = origin.startsWith('https:');
  const loginName = accountCookieName(secure);
  const flowName = secure ? '__Host-orbit-flow' : 'orbit-flow';
  const repo = app.database.accounts;
  const googleHandler = google && createGoogleHandler(repo, google, origin, now, refreshControl);
  const cookie = (name: string, token: string, seconds: number) =>
    authCookie(name, token, seconds, secure);
  let deliveries = 0;
  return async (req: IncomingMessage, res: ServerResponse, path: string) => {
    const reply = (status: number, value: object) => {
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(JSON.stringify(value));
    };
    const fail = (status: number, error: string) => reply(status, { error });
    try {
      const address = () =>
        authClientAddress(
          req.socket.remoteAddress,
          req.headers['x-orbit-client-ip'],
          req.headers['x-orbit-proxy-key'],
          google?.proxyKey ?? options?.proxyKey,
        );
      if (path.startsWith('google/'))
        return googleHandler
          ? await googleHandler(req, res, path, address())
          : fail(404, 'NOT_FOUND');
      const loginHash = cookieHash(req.headers.cookie, loginName);
      if (path === 'me' && req.method === 'GET') {
        const login = loginHash && repo.login(loginHash, now());
        const account = login ? repo.emailForSession(login.session_id) : null;
        const player = login ? app.database.repositories.findSessionById(login.session_id) : null;
        return reply(200, {
          enabled: true,
          googleEnabled: !!google,
          emailEnabled: !!options,
          sessionId: player?.sessionId ?? null,
          nickname: player?.nickname ?? null,
          email: account
            ? account.slice(0, 1) + '***' + account.slice(account.lastIndexOf('@'))
            : null,
        });
      }
      if (req.method !== 'POST') return fail(405, 'METHOD_NOT_ALLOWED');
      if (req.headers.origin !== origin) return fail(403, 'ORIGIN_FORBIDDEN');
      const data = await readBody(req);
      const time = now();
      const login = loginHash && repo.login(loginHash, time);
      if (path === 'logout') {
        if (loginHash && login) {
          repo.revoke(loginHash);
          refreshControl(login.session_id);
        }
        res.setHeader('Set-Cookie', cookie(loginName, '', 0));
        return reply(200, { ok: true });
      }
      if (!options) return fail(404, 'NOT_FOUND');
      const mac = (value: string) =>
        createHmac('sha256', options.codeKey).update(value).digest('hex');
      const ip = mac(address());
      if (!repo.allow('auth:' + ip, time, 60_000, 60)) return fail(429, 'RATE_LIMITED');
      let flow = cookieHash(req.headers.cookie, flowName);
      if (path === 'code/send') {
        const email = emailAddress(data.email);
        const purpose = data.purpose;
        if (!email || (purpose !== 'register' && purpose !== 'reset')) throw new InputError();
        if (deliveries >= 8 || repo.challengeCooling(email, purpose, time))
          return fail(429, 'RATE_LIMITED');
        if (
          !repo.allow('send-ip:' + ip, time, 3600_000, 12) ||
          !repo.allow('send-email:' + mac(email), time, 3600_000, 5) ||
          !repo.allow('send-global', time, 86400_000, 95)
        )
          return fail(429, 'RATE_LIMITED');
        if (!flow) {
          const token = randomToken();
          flow = digest(token);
          res.setHeader('Set-Cookie', cookie(flowName, token, 1800));
        }
        const id = randomUUID();
        const code = String(randomInt(1_000_000)).padStart(6, '0');
        const target = purpose === 'reset' ? repo.findAccount(email)?.email : email;
        repo.createChallenge({
          id,
          email,
          purpose,
          flow_hash: flow,
          code_mac: mac(id + ':' + code),
          created_at: time,
          expires_at: time + codeTtl,
        });
        if (target) {
          deliveries++;
          void Promise.resolve()
            .then(() => options.deliver({ id, email: target, code, purpose }))
            .catch(() => console.warn('AUTH_EMAIL_DELIVERY_FAILED'))
            .finally(() => {
              deliveries--;
            });
        }
        return reply(202, { challengeId: id });
      }
      if (path === 'code/verify') {
        if (
          !flow ||
          typeof data.challengeId !== 'string' ||
          typeof data.code !== 'string' ||
          !/^[0-9]{6}$/.test(data.code)
        )
          throw new InputError();
        const item = repo.readChallenge(data.challengeId, flow, time);
        if (!item) return fail(400, 'INVALID_CODE');
        if (
          !timingSafeEqual(
            Buffer.from(item.code_mac, 'hex'),
            Buffer.from(mac(item.id + ':' + data.code), 'hex'),
          )
        ) {
          repo.attempt(item.id, null, item.expires_at);
          return fail(400, 'INVALID_CODE');
        }
        const proof = randomToken();
        repo.attempt(item.id, digest(proof), time + codeTtl);
        return reply(200, { proof });
      }
      if (path === 'register' || path === 'reset-password') {
        if (!flow || !isToken(data.proof) || !acceptablePassword(data.password))
          throw new InputError();
        const proofHash = digest(data.proof);
        if (!repo.validProof(proofHash, flow, path === 'register' ? 'register' : 'reset', time))
          return fail(400, 'INVALID_PROOF');
        const nickname = path === 'register' ? normalizeNickname(data.nickname) : '';
        const guestHash =
          path === 'register' && data.guestToken != null
            ? hashResumeToken(typeof data.guestToken === 'string' ? data.guestToken : '')
            : null;
        const passwordHash = await hashPassword(data.password);
        if (path === 'reset-password') {
          const sessionId = repo.reset(proofHash, flow, now(), passwordHash);
          if (!sessionId) return fail(400, 'INVALID_PROOF');
          refreshControl(sessionId);
          if (login && login.session_id === sessionId)
            res.setHeader('Set-Cookie', cookie(loginName, '', 0));
          return reply(200, { ok: true });
        }
        const token = randomToken();
        const result = repo.register({
          proof: proofHash,
          flow,
          now: now(),
          sessionId: randomUUID(),
          disabledGuestHash: digest(randomToken()),
          guestHash,
          nickname,
          passwordHash,
          loginHash: digest(token),
          expires: now() + loginTtl,
        });
        if (typeof result === 'string') {
          if (result === 'playing') return fail(409, 'GUEST_HAND_IN_PROGRESS');
          if (result === 'guest') return fail(409, 'GUEST_IDENTITY_EXPIRED');
          if (result === 'exists') return fail(409, 'EMAIL_ALREADY_REGISTERED');
          return fail(400, 'INVALID_PROOF');
        }
        if (loginHash && login) {
          repo.revoke(loginHash);
          refreshControl(login.session_id);
        }
        refreshControl(result.sessionId);
        res.setHeader('Set-Cookie', cookie(loginName, token, loginTtl / 1000));
        return reply(201, { sessionId: result.sessionId });
      }
      if (path === 'login') {
        const email = emailAddress(data.email);
        if (!email || typeof data.password !== 'string' || Buffer.byteLength(data.password) > 512)
          throw new InputError();
        if (!repo.allow('login:' + mac(email), time, 900_000, 10)) return fail(429, 'RATE_LIMITED');
        const account = repo.findAccount(email);
        if (!(await checkPassword(data.password, account?.password_hash)) || !account)
          return fail(401, 'INVALID_LOGIN');
        const token = randomToken();
        if (
          !repo.issueLogin(
            digest(token),
            account.session_id,
            now() + loginTtl,
            account.password_hash,
            now(),
          )
        )
          return fail(401, 'INVALID_LOGIN');
        if (loginHash && login) {
          repo.revoke(loginHash);
          refreshControl(login.session_id);
        }
        res.setHeader('Set-Cookie', cookie(loginName, token, loginTtl / 1000));
        return reply(200, { sessionId: account.session_id });
      }
      return fail(404, 'NOT_FOUND');
    } catch (error) {
      if (
        error instanceof InputError ||
        error instanceof SessionPayloadError ||
        error instanceof InvalidResumeToken
      )
        return fail(400, 'INVALID_INPUT');
      if (error instanceof AuthBusy) return fail(429, 'RATE_LIMITED');
      return fail(503, 'AUTH_UNAVAILABLE');
    }
  };
}

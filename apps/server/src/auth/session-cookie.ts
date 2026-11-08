import { createHash, randomBytes } from 'node:crypto';

export const loginTtl = 30 * 86400_000;
export const randomToken = () => randomBytes(32).toString('base64url');
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const isToken = (value: unknown): value is string =>
  typeof value === 'string' && /^[\w-]{43}$/.test(value);
export const accountCookieName = (secure: boolean) =>
  secure ? '__Host-orbit-login' : 'orbit-login';

export function cookieHash(header: string | undefined, name: string): string | null {
  const pairs =
    header
      ?.split(';')
      .map((part) => part.trim())
      .filter((part) => part.startsWith(name + '=')) ?? [];
  const value = pairs[0]?.slice(name.length + 1);
  return pairs.length === 1 && isToken(value) ? digest(value) : null;
}

export function authCookie(name: string, token: string, seconds: number, secure: boolean) {
  return `${name}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${secure ? '; Secure' : ''}`;
}

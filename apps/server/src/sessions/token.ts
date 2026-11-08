import { randomBytes, createHash } from 'node:crypto';
export class InvalidResumeToken extends Error {
  constructor() {
    super('SESSION_EXPIRED');
    this.name = 'InvalidResumeToken';
  }
}
export function createResumeToken(): string {
  return randomBytes(32).toString('base64url');
}
export function hashResumeToken(token: string): string {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token))
    throw new InvalidResumeToken();
  const bytes = Buffer.from(token, 'base64url');
  if (bytes.length !== 32 || bytes.toString('base64url') !== token) throw new InvalidResumeToken();
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

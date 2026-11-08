import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const policy = { N: 131072, r: 8, p: 1, maxmem: 192 * 1024 * 1024 };
const common = new Set([
  '123456789012345',
  'passwordpassword',
  'qwertyuiopasdfg',
  '1234567890123456',
  'iloveyouiloveyou',
]);
let hashing = 0;
export function acceptablePassword(value: unknown): value is string {
  if (typeof value !== 'string' || Buffer.byteLength(value) > 512 || /[\p{Cc}\p{Cs}]/u.test(value))
    return false;
  const length = [...value].length;
  return (
    length >= 15 &&
    length <= 128 &&
    value.trim().length > 0 &&
    !common.has(value.trim().toLowerCase())
  );
}
export class AuthBusy extends Error {}
async function derive(password: string, salt: Buffer): Promise<Buffer> {
  if (hashing >= 2) throw new AuthBusy();
  hashing++;
  try {
    return await new Promise((resolve, reject) =>
      scrypt(password, salt, 32, policy, (err, key) => (err ? reject(err) : resolve(key))),
    );
  } finally {
    hashing--;
  }
}
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return 'scrypt1$' + salt.toString('hex') + '$' + (await derive(password, salt)).toString('hex');
}
export async function checkPassword(
  password: string,
  stored: string | undefined,
): Promise<boolean> {
  const parsed = /^scrypt1\$([a-f0-9]{32})\$([a-f0-9]{64})$/.exec(stored ?? '');
  const salt = parsed ? Buffer.from(parsed[1]!, 'hex') : Buffer.alloc(16);
  const expected = parsed ? Buffer.from(parsed[2]!, 'hex') : Buffer.alloc(32);
  const matches = timingSafeEqual(await derive(password, salt), expected);
  return !!parsed && matches;
}

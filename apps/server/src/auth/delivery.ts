import { randomBytes } from 'node:crypto';
import type { Purpose } from '../persistence/account-repository.js';

export interface AuthOptions {
  codeKey: Buffer;
  proxyKey?: string;
  deliver(message: { id: string; email: string; purpose: Purpose; code: string }): Promise<void>;
}

export function authOptions(
  env: NodeJS.ProcessEnv,
  host: string,
  webOrigin: string,
): AuthOptions | undefined {
  const mode = env.AUTH_EMAIL_MODE ?? 'disabled';
  if (mode === 'disabled') return undefined;
  if (mode === 'local') {
    if (
      env.NODE_ENV === 'production' ||
      host !== '127.0.0.1' ||
      new URL(webOrigin).hostname !== '127.0.0.1'
    )
      throw Error('LOCAL_EMAIL_MODE_REQUIRES_LOOPBACK');
    return {
      codeKey: randomBytes(32),
      async deliver({ id, code }) {
        console.info('[local-email] ' + id + ' code ' + code);
      },
    };
  }
  const key = env.AUTH_CODE_KEY;
  const apiKey = env.RESEND_API_KEY;
  const from = env.AUTH_EMAIL_FROM;
  const proxyKey = env.AUTH_PROXY_KEY;
  if (
    mode !== 'resend' ||
    !webOrigin.startsWith('https:') ||
    !key ||
    !/^[a-f0-9]{64}$/i.test(key) ||
    !apiKey ||
    !from ||
    !proxyKey ||
    !/^[a-f0-9]{64}$/.test(proxyKey)
  )
    throw Error('EMAIL_AUTH_CONFIG_INVALID');
  return {
    codeKey: Buffer.from(key, 'hex'),
    proxyKey,
    async deliver({ id, email, code, purpose }) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          authorization: 'Bearer ' + apiKey,
          'content-type': 'application/json',
          'idempotency-key': 'orbit-otp/' + id,
        },
        body: JSON.stringify({
          from,
          to: [email],
          subject: '轨道牌桌 · ' + (purpose === 'reset' ? '密码重置' : '注册') + '验证码',
          text: '验证码：' + code + '\n5 分钟内有效。若非本人操作，可以忽略此邮件。',
        }),
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) throw Error('EMAIL_DELIVERY_FAILED');
      await res.body?.cancel();
    },
  };
}

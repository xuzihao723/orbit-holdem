import { OAuth2Client } from 'google-auth-library';

export interface GoogleSignIn {
  proxyKey?: string;
  authorizationUrl(input: { state: string; nonce: string; challenge: string }): string;
  identity(
    code: string,
    verifier: string,
    nonce: string,
  ): Promise<{
    subject: string;
    email: string;
    nickname: string;
  }>;
}

export function googleSignIn(env: NodeJS.ProcessEnv, origin: string): GoogleSignIn | undefined {
  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;
  const proxyKey = env.AUTH_PROXY_KEY;
  if (!clientId && !clientSecret) return undefined;
  const url = new URL(origin);
  if (
    !clientId ||
    !/^[\w-]+\.apps\.googleusercontent\.com$/.test(clientId) ||
    !clientSecret ||
    (url.protocol === 'https:'
      ? !proxyKey || !/^[a-f0-9]{64}$/.test(proxyKey)
      : url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname))
  )
    throw Error('GOOGLE_AUTH_CONFIG_INVALID');

  const redirectUri = origin + '/api/auth/google/callback';
  const client = new OAuth2Client({
    clientId,
    transporterOptions: { timeout: 6000, retry: false },
  });
  return {
    ...(proxyKey ? { proxyKey } : {}),
    authorizationUrl({ state, nonce, challenge }) {
      return (
        'https://accounts.google.com/o/oauth2/v2/auth?' +
        new URLSearchParams({
          client_id: clientId,
          redirect_uri: redirectUri,
          response_type: 'code',
          scope: 'openid email profile',
          prompt: 'select_account',
          state,
          nonce,
          code_challenge: challenge,
          code_challenge_method: 'S256',
        })
      );
    },
    async identity(code, verifier, nonce) {
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
          code_verifier: verifier,
          code,
        }),
        signal: AbortSignal.timeout(6000),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw Error('GOOGLE_TOKEN_EXCHANGE_FAILED');
      }
      const tokens: unknown = await response.json();
      if (
        !tokens ||
        typeof tokens !== 'object' ||
        !('id_token' in tokens) ||
        typeof tokens.id_token !== 'string'
      )
        throw Error('GOOGLE_ID_TOKEN_MISSING');
      const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: clientId });
      const identity = ticket.getPayload() as ReturnType<typeof ticket.getPayload> & {
        nonce?: string;
      };
      if (
        !identity ||
        identity.nonce !== nonce ||
        typeof identity.sub !== 'string' ||
        !/^[\w-]{1,255}$/.test(identity.sub) ||
        identity.email_verified !== true ||
        typeof identity.email !== 'string' ||
        !/^[^\s@]+@[^\s@]+$/.test(identity.email) ||
        identity.email.length > 254
      )
        throw Error('GOOGLE_IDENTITY_INVALID');
      const name =
        typeof identity.name === 'string'
          ? identity.name.replace(/[\p{Cc}\p{Cf}]/gu, '').trim()
          : '';
      const nickname = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(name)]
        .slice(0, 12)
        .map(({ segment }) => segment)
        .join('')
        .trim();
      return { subject: identity.sub, email: identity.email, nickname: nickname || 'Google 玩家' };
    },
  };
}

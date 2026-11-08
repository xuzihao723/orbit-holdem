import { useEffect, useState, type FormEvent } from 'react';
import { useAccount, useNetwork } from '../app/NetworkProvider';
import { accountRequest } from '../network/account-client';
import { accountReturn } from '../app/router';

type Mode = 'login' | 'register' | 'reset-password' | 'account';
const titles = {
  login: '登录轨道牌桌',
  register: '注册账号',
  'reset-password': '找回密码',
  account: '我的账号',
};
const errors: Record<string, string> = {
  INVALID_LOGIN: '邮箱或密码不正确。',
  INVALID_CODE: '验证码错误或已过期，请检查或重新发送。',
  INVALID_PROOF: '验证已过期，请重新验证邮箱。',
  INVALID_INPUT: '请检查输入。密码需为 15–128 个字符，昵称需为 1–12 个字。',
  EMAIL_ALREADY_REGISTERED: '此邮箱已经注册，请登录或找回密码。',
  GUEST_HAND_IN_PROGRESS: '当前牌局仍在进行，请在本手结束后升级账号。',
  GUEST_IDENTITY_EXPIRED: '游客身份已失效，请取消保留记录选项后再注册。',
  RATE_LIMITED: '操作过于频繁，请稍后再试。',
};

export default function AccountPage({ mode, path }: { mode: Mode; path: string }) {
  const account = useAccount();
  const query = new URLSearchParams(path.split('?')[1] ?? '');
  if (
    mode === 'account' ||
    (account.emailEnabled && (!account.googleEnabled || query.get('method') === 'email'))
  )
    return <EmailAccountPage mode={mode} path={path} />;

  const next = accountReturn(query.get('next'));
  const outcome = query.get('google');
  return (
    <main className="app-page setup-page account-page auth-page">
      <section className="account-panel">
        <p className="eyebrow">ORBIT / 账号</p>
        <h1>登录轨道牌桌</h1>
        <p className="page-lead">使用已有 Google 账号进入牌桌。首次授权后自动创建账号。</p>
        <form method="post" action={'/api/auth/google/start?next=' + encodeURIComponent(next)}>
          <button className="primary" disabled={!account.googleEnabled}>
            使用 Google 登录
          </button>
        </form>
        {!account.googleEnabled && (
          <p className="help-text">Google 登录待配置。现在可以以游客继续。</p>
        )}
        {outcome === 'cancelled' && <p role="status">已取消 Google 登录，可以重新选择账号。</p>}
        {outcome === 'failed' && (
          <p className="form-error" role="alert">
            Google 登录未完成，请重试。
          </p>
        )}
        <nav className="home-secondary" aria-label="账号入口">
          <a href={next}>以游客继续</a>
          {account.emailEnabled && (
            <a href={'/login?' + new URLSearchParams({ method: 'email', next })}>旧邮箱账号登录</a>
          )}
        </nav>
      </section>
      <a href="/">返回首页</a>
    </main>
  );
}

function EmailAccountPage({ mode, path }: { mode: Mode; path: string }) {
  const account = useAccount();
  const { client, intents, router } = useNetwork();
  const next = accountReturn(new URLSearchParams(path.split('?')[1] ?? '').get('next'));
  const nextParams = new URLSearchParams();
  if (account.googleEnabled) nextParams.set('method', 'email');
  if (next !== '/') nextParams.set('next', next);
  const nextQuery = nextParams.size ? '?' + nextParams : '';
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [challenge, setChallenge] = useState('');
  const [proof, setProof] = useState('');
  const [upgrade, setUpgrade] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [cooldown, setCooldown] = useState(0);
  useEffect(() => {
    if (cooldown < 1) return;
    const timer = setTimeout(() => setCooldown((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);
  const purpose = mode === 'register' ? 'register' : 'reset';
  const guest = client.credentials.read();
  const send = async () => {
    const result = await accountRequest<{ challengeId: string }>('code/send', { email, purpose });
    setChallenge(result.challengeId);
    setCode('');
    setCooldown(60);
  };
  const run = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (reason) {
      setError(
        errors[reason instanceof Error ? reason.message : ''] ?? '账号服务暂不可用，请稍后重试。',
      );
    } finally {
      setBusy(false);
    }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      if (mode === 'login') {
        await accountRequest('login', { email, password });
        intents.clear();
        location.assign(next);
      } else if (!challenge) {
        await send();
      } else if (!proof) {
        const result = await accountRequest<{ proof: string }>('code/verify', {
          challengeId: challenge,
          code,
        });
        setProof(result.proof);
        setCode('');
      } else if (mode === 'register') {
        await accountRequest('register', {
          proof,
          password,
          nickname,
          ...(upgrade && guest ? { guestToken: guest.resumeToken } : {}),
        });
        if (upgrade) client.credentials.clear();
        intents.clear();
        location.assign(next);
      } else {
        await accountRequest('reset-password', { proof, password });
        router.navigate('/login' + nextQuery);
      }
    });
  };
  const startOver = () => {
    setChallenge('');
    setProof('');
    setCode('');
    setPassword('');
    setError('');
  };
  return (
    <main
      className={
        mode === 'account'
          ? 'app-page setup-page account-page'
          : 'app-page setup-page account-page auth-page'
      }
    >
      <section className="account-panel">
        <p className="eyebrow">ORBIT / 账号</p>
        <h1>{titles[mode]}</h1>
        {mode === 'account' ? (
          account.sessionId ? (
            <>
              <div className="account-identity">
                <span className="brand-mark" aria-hidden="true">
                  ♠
                </span>
                <p>
                  <strong>{account.nickname}</strong> · {account.email}
                </p>
                <span className="account-status">已登录</span>
              </div>
              <button
                className="danger-action"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await accountRequest('logout', {});
                    intents.clear();
                    location.assign('/');
                  })
                }
              >
                退出登录
              </button>
            </>
          ) : (
            <a href="/login">登录账号</a>
          )
        ) : (
          <>
            <p className="page-lead">
              {mode === 'login'
                ? '用已验证的邮箱和轨道牌桌密码登录。'
                : '验证邮箱后设置轨道牌桌密码。'}
            </p>
            <form onSubmit={submit} aria-busy={busy}>
              {mode === 'login' || !challenge ? (
                <label>
                  邮箱
                  <input
                    type="email"
                    autoComplete="email"
                    required
                    maxLength={254}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={busy}
                  />
                </label>
              ) : (
                <p className="help-text">请查收 {email} 的验证码。</p>
              )}
              {challenge && !proof && (
                <>
                  <label>
                    验证码
                    <input
                      autoComplete="one-time-code"
                      inputMode="numeric"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      required
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      disabled={busy}
                    />
                  </label>
                  <div className="control-row">
                    <button
                      type="button"
                      disabled={busy || cooldown > 0}
                      onClick={() => void run(send)}
                    >
                      {cooldown > 0 ? cooldown + ' 秒后可重发' : '重发验证码'}
                    </button>
                    <button type="button" disabled={busy} onClick={startOver}>
                      修改邮箱
                    </button>
                  </div>
                </>
              )}
              {proof && mode === 'register' && (
                <>
                  <label>
                    昵称
                    <input
                      autoComplete="nickname"
                      required
                      maxLength={48}
                      value={nickname}
                      onChange={(e) => setNickname(e.target.value)}
                      disabled={busy}
                    />
                  </label>
                  {guest && (
                    <label className="choice-row">
                      <input
                        type="checkbox"
                        checked={upgrade}
                        onChange={(e) => setUpgrade(e.target.checked)}
                        disabled={busy}
                      />
                      保留当前游客的牌局记录
                    </label>
                  )}
                </>
              )}
              {(mode === 'login' || proof) && (
                <label>
                  {mode === 'login' ? '密码' : mode === 'register' ? '设置密码' : '设置新密码'}
                  <input
                    type="password"
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                    required
                    maxLength={256}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={busy}
                  />
                </label>
              )}
              {proof && <p className="help-text">使用至少 15 个字符的密码或口令。</p>}
              <button
                className="primary"
                disabled={busy || (!challenge && mode !== 'login' && cooldown > 0)}
              >
                {busy
                  ? '处理中…'
                  : mode === 'login'
                    ? '登录'
                    : !challenge
                      ? '发送验证码'
                      : !proof
                        ? '验证邮箱'
                        : mode === 'register'
                          ? '创建账号'
                          : '重置密码'}
              </button>
              {proof && (
                <button type="button" disabled={busy} onClick={startOver}>
                  重新验证邮箱
                </button>
              )}
            </form>
            <nav className="home-secondary" aria-label="账号入口">
              {mode === 'login' ? (
                <>
                  <a href={'/register' + nextQuery}>注册账号</a>
                  <a href={'/reset-password' + nextQuery}>忘记密码</a>
                </>
              ) : (
                <a href={'/login' + nextQuery}>返回登录</a>
              )}
              <a href={next}>以游客继续</a>
            </nav>
          </>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </section>
      <a href="/">返回首页</a>
    </main>
  );
}

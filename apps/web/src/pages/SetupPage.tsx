import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useAccount, useNetwork } from '../app/NetworkProvider';
import type { Capacity, BotDifficulty } from '@orbit/protocol';
import {
  beginEntry,
  provisionRoom,
  ensureEntryIdentity,
  validateEntryConfig,
} from '../features/room/provision-room';
import { roomErrorMessage } from '../features/room/room-errors';
import PlayingCard from '../components/cards/PlayingCard';
import type { CardId } from '@orbit/protocol';
import { probeGameServer, waitForGameServer } from '../network/server-readiness';
import ServerConnectionPage from './ServerConnectionPage';

const entryArt = {
  solo: {
    title: '挑选你的对手',
    description: '与电脑同桌，按自己的节奏练习。',
    cards: ['AS', 'KH'],
  },
  create: {
    title: '留个位置给朋友',
    description: '创建牌桌后，可以复制邀请链接给朋友。',
    cards: ['QS', 'JH'],
  },
  join: {
    title: '入座同一张牌桌',
    description: '用朋友发来的 6 位房间码找到牌桌。',
    cards: ['9S', '8H'],
  },
} satisfies Record<string, { title: string; description: string; cards: CardId[] }>;
export default function SetupPage({
  mode,
  code,
}: {
  mode: 'solo' | 'create' | 'join';
  code: string;
}) {
  const { client, gameOrigin, intents, router, snapshot } = useNetwork(),
    saved = intents.read();
  const account = useAccount();
  const [nicknameInput, setNickname] = useState<string | null>(null),
    [capacity, setCapacity] = useState<Capacity>(4),
    [count, setCount] = useState(1),
    [difficulty, setDifficulty] = useState<BotDifficulty>('basic'),
    [roomCode, setCode] = useState(code),
    [pending, setPending] = useState(false),
    [error, setError] = useState(''),
    [connection, setConnection] = useState<{ timedOut: boolean; continuing: boolean } | null>(null);
  const entry = useRef<AbortController | null>(null);
  useEffect(() => {
    const warmup = new AbortController();
    void probeGameServer(gameOrigin, warmup.signal);
    return () => {
      warmup.abort();
      entry.current?.abort();
      entry.current = null;
    };
  }, [gameOrigin]);
  const unfinished =
      saved && saved.sessionId === client.identitySessionId && saved.status !== 'complete'
        ? saved
        : null,
    titles = { solo: '单人练习', create: '创建房间', join: '加入房间' },
    title = titles[mode];
  const nickname = nicknameInput ?? unfinished?.config.nickname ?? account.nickname ?? '';
  const run = async (continuing = false) => {
    if (entry.current) return;
    const attempt = new AbortController();
    entry.current = attempt;
    let showWaiting: ReturnType<typeof setTimeout> | undefined;
    setPending(true);
    setError('');
    setConnection(null);
    try {
      const config =
        continuing && unfinished
          ? unfinished.config
          : validateEntryConfig({
              mode,
              nickname,
              capacity: mode === 'solo' ? ((count + 1) as Capacity) : capacity,
              botCount: mode === 'solo' ? count : 0,
              difficulty,
              roomCode,
            });
      if (!client.connected) {
        showWaiting = setTimeout(() => {
          if (!attempt.signal.aborted) setConnection({ timedOut: false, continuing });
        }, 350);
        await waitForGameServer(gameOrigin, attempt.signal);
        clearTimeout(showWaiting);
        setConnection(null);
      }
      if (continuing && unfinished) {
        await ensureEntryIdentity(client, unfinished.config.nickname);
        if (client.store.snapshot.authContext?.sessionId !== unfinished.sessionId)
          throw Error('ENTRY_IDENTITY_CHANGED');
      }
      const intent =
        continuing && unfinished ? unfinished : await beginEntry(client, intents, config);
      attempt.signal.throwIfAborted();
      const room = await provisionRoom(client, intents, intent);
      attempt.signal.throwIfAborted();
      router.navigate('/room/' + room.roomCode);
    } catch (e) {
      if (attempt.signal.aborted) return;
      if (e instanceof Error && e.message === 'SERVER_START_TIMEOUT') {
        setConnection({ timedOut: true, continuing });
      } else {
        setConnection(null);
        setError(roomErrorMessage(e));
      }
    } finally {
      clearTimeout(showWaiting);
      if (entry.current === attempt) {
        entry.current = null;
        setPending(false);
      }
    }
  };
  if (connection) {
    return (
      <ServerConnectionPage
        timedOut={connection.timedOut}
        onBack={() => {
          entry.current?.abort();
          entry.current = null;
          setPending(false);
          setConnection(null);
        }}
        onRetry={() => void run(connection.continuing)}
      />
    );
  }
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run();
  };
  return (
    <main className="app-page setup-page entry-page">
      <a href="/">返回首页</a>
      <p className="eyebrow">ORBIT / 入座</p>
      <h1>{title}</h1>
      <p className="page-lead">虚拟筹码，每人入场 2,000。无需坐满四人。</p>
      <div className="entry-grid">
        <aside className="entry-art">
          <h2>{entryArt[mode].title}</h2>
          <p>{entryArt[mode].description}</p>
          <div className="entry-cards" aria-hidden="true">
            {entryArt[mode].cards.map((card) => (
              <PlayingCard key={card} card={card} compact />
            ))}
          </div>
        </aside>
        <div className="entry-form">
          <form onSubmit={submit} aria-busy={pending}>
            <label htmlFor="nickname">昵称</label>
            <input
              id="nickname"
              autoComplete="nickname"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              disabled={pending}
              required
              aria-describedby="nickname-help"
            />
            <p id="nickname-help" className="help-text">
              1–12个字，支持中文与表情。昵称将显示给同桌玩家。
            </p>
            {mode === 'join' ? (
              <>
                <label htmlFor="room-code-input">房间码</label>
                <input
                  id="room-code-input"
                  value={roomCode}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  autoCapitalize="characters"
                  spellCheck={false}
                  disabled={pending}
                  required
                />
                <p className="help-text">6位房间码；正在进行的一手结束后可加入。</p>
              </>
            ) : (
              <fieldset disabled={pending}>
                <legend>{mode === 'solo' ? '对战电脑' : '房间容量'}</legend>
                <div className="choice-row">
                  {(mode === 'solo' ? [1, 2, 3] : [2, 3, 4]).map((n) => (
                    <label key={n}>
                      <input
                        type="radio"
                        name="capacity"
                        checked={mode === 'solo' ? count === n : capacity === n}
                        onChange={() =>
                          mode === 'solo' ? setCount(n) : setCapacity(n as Capacity)
                        }
                      />
                      {mode === 'solo' ? n + '个电脑' : n + '人容量'}
                    </label>
                  ))}
                </div>
                <p className="help-text">
                  {mode === 'solo'
                    ? `总人数 ${count + 1} 人，各自独立行动。`
                    : '容量是上限，至少2人即可满足人数条件。'}
                </p>
              </fieldset>
            )}
            {mode === 'solo' && (
              <fieldset disabled={pending}>
                <legend>电脑难度</legend>
                <div className="choice-row">
                  {(['basic', 'standard'] as const).map((d) => (
                    <label key={d}>
                      <input
                        type="radio"
                        name="difficulty"
                        checked={difficulty === d}
                        onChange={() => setDifficulty(d)}
                      />
                      {d === 'basic' ? '入门' : '标准'}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
            <button
              className="primary"
              type="submit"
              disabled={pending || !!unfinished || snapshot.status === 'takenOver'}
            >
              {pending ? '正在设置…' : title}
            </button>
          </form>
          {account.enabled && !account.sessionId && (
            <a
              className="entry-login"
              href={'/login?next=' + encodeURIComponent(location.pathname + location.search)}
            >
              登录后继续
            </a>
          )}
          {unfinished && (
            <section className="entry-recovery" aria-label="未完成的设置">
              <h2>继续上次设置</h2>
              <p>
                已确认 {unfinished.steps.filter((s) => s.status === 'confirmed').length} 步。
                {unfinished.roomCode
                  ? '已创建房间 ' + unfinished.roomCode
                  : '首步结果可能尚未确认。'}
              </p>
              <p className="help-text">将沿用原请求，避免重复创建房间或电脑。</p>
              <button disabled={pending} onClick={() => void run(true)}>
                继续设置
              </button>
              {unfinished.roomCode && <a href={'/room/' + unfinished.roomCode}>回到房间</a>}
              {unfinished.status === 'failed' && !unfinished.roomId && (
                <button
                  disabled={pending}
                  onClick={() => {
                    intents.clear();
                    setError('请修改设置后重新提交。');
                  }}
                >
                  修改设置
                </button>
              )}
            </section>
          )}
        </div>
      </div>
    </main>
  );
}

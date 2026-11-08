import { useEffect, useState, useSyncExternalStore } from 'react';
import type { HistoryItem } from '@orbit/protocol';
import { useNetwork } from '../app/NetworkProvider';
import { QueryStore } from '../network/query-store';
import { roomErrorMessage } from '../features/room/room-errors';
interface Data {
  items: HistoryItem[];
  nextCursor: string | null;
}
export default function HistoryPage() {
  const { client, snapshot } = useNetwork(),
    [store] = useState(() => new QueryStore<Data>()),
    [retry, setRetry] = useState(0),
    q = useSyncExternalStore(
      store.subscribe,
      () => store.snapshot,
      () => store.snapshot,
    ),
    binding = (snapshot.authContext?.sessionId ?? '') + ':' + (snapshot.activeEpoch ?? '');
  const load = (cursor: string | null, previous: HistoryItem[] = []) =>
    void store.load(binding, async () => {
      const response = await client.historyList({ cursor, limit: 20 });
      if (!response.ok) throw Error(response.code);
      const items = [...previous, ...response.items];
      if (new Set(items.map((i) => i.handId)).size !== items.length)
        throw Error('INVALID_QUERY_RESPONSE');
      return { items, nextCursor: response.nextCursor };
    });
  useEffect(() => {
    if (snapshot.controlReady) load(null);
    else store.clear();
    return () => store.clear();
  }, [binding, snapshot.controlReady, retry]);
  if (!snapshot.controlReady)
    return (
      <main className="app-page history-page">
        <a href="/">返回首页</a>
        <p className="eyebrow">ORBIT / HAND HISTORY</p>
        <h1>历史记录</h1>
        <p>请先恢复原访客身份。原凭据丢失后，无法按昵称找回历史。</p>
      </main>
    );
  const data = q.binding === binding ? q.data : null;
  return (
    <main className="app-page history-page">
      <a href="/">返回首页</a>
      <p className="eyebrow">ORBIT / HAND HISTORY</p>
      <h1>历史记录</h1>
      <p>手内变化 = 结束筹码 − 本手起始筹码；退款不单算赢池，入场与重开增发不计盈利。</p>
      {q.phase === 'loading' && <p role="status">正在读取本人历史…</p>}
      {q.phase === 'error' && (
        <>
          <p role="alert">{roomErrorMessage(Error(q.error))}</p>
          <button onClick={() => setRetry((n) => n + 1)}>重新读取历史</button>
        </>
      )}
      {data?.items.length === 0 && <p role="status">还没有已结束的参赛记录。</p>}
      {data && (
        <ol className="history-list">
          {data.items.map((item) => (
            <li key={item.handId}>
              <div>
                <strong>
                  {item.status === 'interrupted'
                    ? '本手中止'
                    : item.wonAnyPot
                      ? '获得底池'
                      : '本手结束'}
                </strong>
                <span>
                  {new Date(item.startedAt).toLocaleString('zh-CN')} · {item.playerCount}人
                </span>
              </div>
              <p className="history-stack">
                {item.startingStack} → {item.endingStack ?? '未结算'}
              </p>
              <p className="history-change">
                <span>手内变化</span>{' '}
                <strong
                  data-direction={
                    item.netHandChange === null || item.netHandChange === 0
                      ? undefined
                      : item.netHandChange > 0
                        ? 'gain'
                        : 'loss'
                  }
                >
                  {item.netHandChange === null
                    ? '不计'
                    : (item.netHandChange > 0 ? '+' : '') + item.netHandChange}
                </strong>
              </p>
              <a className="button-link" href={'/history/' + encodeURIComponent(item.handId)}>
                查看回放
              </a>
            </li>
          ))}
        </ol>
      )}
      {data?.nextCursor && (
        <button disabled={q.phase === 'loading'} onClick={() => load(data.nextCursor, data.items)}>
          加载更多
        </button>
      )}
    </main>
  );
}

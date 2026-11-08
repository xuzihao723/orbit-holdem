import { useEffect, useState, useSyncExternalStore } from 'react';
import type { ReplayView } from '@orbit/protocol';
import { useNetwork } from '../app/NetworkProvider';
import { QueryStore } from '../network/query-store';
import { useReplayPlayer } from '../features/replay/use-replay-player';
import ReplayControls from '../features/replay/ReplayControls';
import TableSurface from '../features/table/TableSurface';
import PotSummary from '../features/table/PotSummary';
import { roomErrorMessage } from '../features/room/room-errors';
function ReadyReplay({ view }: { view: ReplayView }) {
  const { player, state } = useReplayPlayer(view.frames),
    frame = view.frames[state.index]!,
    own = frame.state.players.find((p) => p.participantId === view.viewerParticipantId);
  const label = (id: string) =>
    '座位 ' + ((frame.state.players.find((p) => p.participantId === id)?.seatId ?? 0) + 1);
  return (
    <div className="replay-scene">
      <TableSurface
        hand={frame.state}
        self={{ holeCards: frame.ownerHoleCards }}
        viewerSeatId={own?.seatId ?? null}
        seats={frame.state.players.map((p) => ({ ...p, nickname: label(p.participantId) }))}
        connection="connected"
        remainingSeconds={null}
        live
        replay
      />
      <ReplayControls view={view} player={player} index={state.index} playing={state.playing} />
      {frame.state.phase === 'interrupted' && <p role="status">本手已中止，无最终结算。</p>}
      {frame.state.phase === 'settled' && view.result && (
        <PotSummary result={view.result} label={label} />
      )}
    </div>
  );
}
export default function ReplayPage({ handId }: { handId: string }) {
  const { client, snapshot } = useNetwork(),
    [store] = useState(() => new QueryStore<ReplayView>()),
    [retry, setRetry] = useState(0),
    q = useSyncExternalStore(
      store.subscribe,
      () => store.snapshot,
      () => store.snapshot,
    ),
    binding = [snapshot.authContext?.sessionId, snapshot.activeEpoch, handId].join(':');
  useEffect(() => {
    if (snapshot.controlReady)
      void store.load(binding, async () => {
        const response = await client.replayGet(handId);
        if (!response.ok) throw Error(response.code);
        return response;
      });
    else store.clear();
    return () => store.clear();
  }, [binding, snapshot.controlReady, retry]);
  const view = snapshot.controlReady && q.binding === binding ? q.data : null;
  return (
    <main className="app-page replay-page">
      <a href="/history">返回历史记录</a>
      <h1>本手回放</h1>
      <p>仅展示当时已公开的桌面和本人的底牌。回放不改变实时对局，也不自动播放音效。</p>
      {!snapshot.controlReady ? (
        <p>请先恢复原访客身份。</p>
      ) : q.phase === 'loading' ? (
        <p role="status">正在读取授权回放…</p>
      ) : null}
      {snapshot.controlReady && q.phase === 'error' && (
        <>
          <p role="alert">{roomErrorMessage(Error(q.error))}</p>
          <button onClick={() => setRetry((n) => n + 1)}>重新读取回放</button>
        </>
      )}
      {view && <ReadyReplay key={binding} view={view} />}
    </main>
  );
}

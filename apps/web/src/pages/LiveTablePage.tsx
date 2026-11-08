import { useEffect, useRef, useState } from 'react';
import { useNetwork } from '../app/NetworkProvider';
import { ServerTimeClock } from '../network/server-clock';
import TableScene from '../features/table/TableScene';
import ActionBar from '../features/table/ActionBar';
import AllInConfirmDialog from '../features/table/AllInConfirmDialog';
import HandResultDialog from '../features/table/HandResultDialog';
import { useTableActions } from '../features/table/use-table-actions';
import { roomErrorMessage } from '../features/room/room-errors';
export default function LiveTablePage({ code }: { code: string }) {
  const { snapshot, client, router } = useNetwork(),
    room = snapshot.roomView,
    view = snapshot.playerView,
    clock = useRef(new ServerTimeClock()),
    [now, setNow] = useState(() => performance.now()),
    [closedResult, setClosedResult] = useState<string | null>(null),
    [readyBusy, setReadyBusy] = useState(false),
    [readyError, setReadyError] = useState(''),
    readyLock = useRef(false);
  const actions = useTableActions(() =>
    clock.current.remainingMs(
      client.store.snapshot.playerView?.deadline ?? null,
      performance.now(),
    ),
  );
  useEffect(() => {
    if (view) {
      clock.current.observe(view.serverTime, performance.now());
      setNow(performance.now());
    }
  }, [view]);
  useEffect(() => {
    const t = setInterval(() => setNow(performance.now()), 250);
    return () => clearInterval(t);
  }, []);
  if (
    !room ||
    room.roomCode !== code ||
    !view ||
    view.roomId !== room.roomId ||
    snapshot.authContext?.participantId !== view.self.participantId
  )
    return (
      <main className="app-page">
        <h1>桌面尚未恢复</h1>
        <p>只有本人恢复成功后才显示已授权的桌面。</p>
        <a href={'/room/' + code}>返回等待房间</a>
      </main>
    );
  const seat = room.seats.find(
      (s) => s.occupant?.participantId === snapshot.authContext?.participantId,
    ),
    remaining = clock.current.remainingMs(view.deadline, now),
    own = view.players.find((p) => p.participantId === view.self.participantId),
    legal =
      own &&
      !own.folded &&
      !own.allIn &&
      own.seatId === view.actorSeatId &&
      view.self.admission === 'active'
        ? view.self.legalActions
        : null,
    result =
      snapshot.result?.handId === view.handId && snapshot.result.serverEpoch === view.serverEpoch
        ? snapshot.result
        : null,
    resultKey = result ? result.serverEpoch + ':' + result.handId + ':' + result.handVersion : null;
  const ready = async () => {
    if (readyLock.current) return;
    readyLock.current = true;
    setReadyBusy(true);
    setReadyError('');
    try {
      const current = client.store.snapshot;
      if (!current.controlReady || current.roomView?.currentHandId !== view.handId)
        throw Error('STALE_ACTION');
      const ack = await client.sendCommand('room:ready', {
        commandId: crypto.randomUUID(),
        roomId: room.roomId,
        expectedRoomVersion: current.roomView.roomVersion,
        ready: true,
      });
      if (!ack.ok) throw Error(ack.code);
      setClosedResult(resultKey);
      router.navigate('/room/' + code);
    } catch (e) {
      setReadyError(roomErrorMessage(e));
    } finally {
      readyLock.current = false;
      setReadyBusy(false);
    }
  };
  return (
    <main
      className="app-page live-table"
      data-hand-id={view.handId}
      data-hand-version={view.handVersion}
    >
      <div className="table-toolbar">
        <a href={'/room/' + code}>
          <span aria-hidden="true">← </span>返回等待房间
        </a>
        <h1 tabIndex={-1}>当前牌桌</h1>
      </div>
      <TableScene
        table={{
          room,
          hand: view,
          self: view.self,
          viewerSeatId: seat?.seatId ?? null,
          connection: snapshot.controlReady ? 'connected' : 'disconnected',
          remainingSeconds: remaining === null ? null : Math.ceil(remaining / 1000),
          live: true,
        }}
      />
      <ActionBar
        legal={legal}
        message={legal ? '轮到你行动' : view.phase === 'settled' ? '本手已结束' : '等待牌局更新'}
        onAction={actions.submit}
        disabled={actions.disabled}
        committed={own?.streetCommitted ?? 0}
        stack={own?.stack ?? 0}
        actionId={view.handId + ':' + view.handVersion}
      />
      {actions.error && <p role="alert">{actions.error}</p>}
      {actions.retry && (
        <button onClick={actions.retry} disabled={actions.busy}>
          原请求重试
        </button>
      )}
      {actions.confirm && (
        <AllInConfirmDialog
          amount={actions.confirm.amount}
          onConfirm={actions.confirmAllIn}
          onClose={actions.closeConfirm}
        />
      )}
      {result && closedResult !== resultKey && (
        <HandResultDialog
          result={result}
          label={(id) =>
            room.seats.find((s) => s.occupant?.participantId === id)?.occupant?.nickname ??
            '座位 ' + ((result.finalStacks.find((p) => p.participantId === id)?.seatId ?? 0) + 1)
          }
          onClose={() => setClosedResult(resultKey)}
          onReady={() => void ready()}
          busy={readyBusy || !snapshot.controlReady || room.status === 'matchFinished'}
          error={readyError}
        />
      )}
      {result && closedResult === resultKey && (
        <button onClick={() => setClosedResult(null)}>查看本手结算</button>
      )}
    </main>
  );
}

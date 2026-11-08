import { useEffect, useState } from 'react';
import { useNetwork } from '../app/NetworkProvider';
import SeatList from '../features/room/SeatList';
import RoomControls from '../features/room/RoomControls';
import { identifySelf } from '../features/room/provision-room';
import { inviteLink } from '../features/room/invite-link';
import type { StartBlockReason } from '@orbit/protocol';
const reasons: Record<StartBlockReason, string> = {
  ROOM_NOT_WAITING: '本手进行中',
  NOT_ENOUGH_PLAYERS: '还需一名参与者',
  PARTICIPANT_NOT_READY: '有真人尚未准备',
  PARTICIPANT_OFFLINE: '有真人离线保座中',
  HOST_OFFLINE: '房主离线保座中',
  RESET_CONSENT_MISSING: '等待重新开场同意',
  PENDING_BOUNDARY_CHANGE: '等待席位变更',
  ROOM_PAUSED: '房间已暂停',
};
const honeycombCells = [
  'west',
  'southwest',
  'southeast',
  'east',
  'northeast',
  'northwest',
  'center',
] as const;
export default function LiveLobbyPage({ code }: { code: string }) {
  const { snapshot, client, recovery, router } = useNetwork(),
    [copied, setCopied] = useState(''),
    room = snapshot.roomView;
  useEffect(() => {
    if (
      snapshot.controlReady &&
      room?.roomCode === code &&
      room.status === 'playing' &&
      snapshot.playerView?.handId === room.currentHandId
    )
      router.navigate('/table/' + code);
  }, [snapshot.controlReady, room, snapshot.playerView, code, router]);
  if (!room || room.roomCode !== code)
    return (
      <main className="app-page">
        <a href="/">返回首页</a>
        <h1>恢复房间</h1>
        <p>房间码只用于定位。请恢复本人身份，或通过邀请加入。</p>
        {client.identitySessionId && (
          <button onClick={() => void recovery.start()}>恢复本人席位</button>
        )}
        <a className="button-link" href={'/play?mode=join&room=' + code}>
          加入此房间
        </a>
      </main>
    );
  const self = identifySelf(room, snapshot.authContext),
    occupied = room.seats.filter((s) => s.occupant).length,
    url = inviteLink(location.origin, code);
  const waiting =
    snapshot.controlReady &&
    !room.canStart &&
    (room.status === 'waiting' || room.status === 'betweenHands');
  return (
    <main className="app-page live-lobby">
      <a href="/">返回首页</a>
      <header className="live-room-heading">
        <div>
          <p className="eyebrow">ORBIT / 等待房间</p>
          <h1>等待开局</h1>
        </div>
        <span className="occupancy" data-testid="lobby-occupancy">
          {occupied} / {room.capacity}
        </span>
      </header>
      <section className="live-room-status" aria-label="开局条件">
        {waiting && (
          <div className="honeycomb" aria-hidden="true">
            {honeycombCells.map((cell) => (
              <span key={cell} />
            ))}
          </div>
        )}
        <div role="status">
          <strong>
            {room.canStart
              ? '满足服务端开局条件'
              : room.startBlockReasons.map((r) => reasons[r]).join('；') || '等待房间更新'}
          </strong>
          <p>至少2名参与者，无需坐满。真人准备后，由房主开始本手。</p>
          {room.resetProposal && <p>房主已提议重新开场；同意后，开局时每人重置为2,000筹码。</p>}
          {room.status === 'closed' && <p>房间已关闭，可以创建或加入其他房间。</p>}
        </div>
      </section>
      <div className="lobby-panels">
        <section className="lobby-panel" aria-labelledby="invite-title">
          <h2 id="invite-title">邀请朋友</h2>
          <div className="invite-row">
            <p>
              房间码 <strong>{code}</strong>
            </p>
            <button
              onClick={() => {
                void navigator.clipboard
                  ?.writeText(url)
                  .then(() => setCopied('邀请链接已复制。'))
                  .catch(() => setCopied('请手动选择并复制下方邀请链接。'));
                if (!navigator.clipboard) setCopied('请手动选择并复制下方邀请链接。');
              }}
            >
              复制邀请
            </button>
          </div>
          <label className="invite-copy">
            邀请链接
            <input readOnly value={url} onFocus={(e) => e.target.select()} />
          </label>
          {copied && <p role="status">{copied}</p>}
        </section>
        <section className="lobby-panel" aria-labelledby="lobby-seats-title">
          <h2 id="lobby-seats-title">房间席位</h2>
          <SeatList room={room} selfId={self?.participantId ?? null} />
        </section>
      </div>
      {!self && <p role="status">本人席位尚未恢复，暂不能操作。</p>}
      <RoomControls room={room} />
      {room.currentHandId && (
        <a className="button-link" href={'/table/' + code}>
          返回当前牌桌
        </a>
      )}
    </main>
  );
}

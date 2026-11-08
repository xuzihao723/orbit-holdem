import type { RoomView, SeatId, StartBlockReason } from '@orbit/protocol';
import PlayerSeat from '../features/table/PlayerSeat';
const reasons: Record<StartBlockReason, string> = {
  ROOM_NOT_WAITING: '本手进行中，等待下一手',
  NOT_ENOUGH_PLAYERS: '还需一名参与者',
  PARTICIPANT_NOT_READY: '有参与者尚未准备',
  PARTICIPANT_OFFLINE: '有参与者离线保座中',
  HOST_OFFLINE: '房主离线保座中',
  RESET_CONSENT_MISSING: '等待重新开场同意',
  PENDING_BOUNDARY_CHANGE: '等待座位变更完成',
  ROOM_PAUSED: '房间已暂停',
};
export default function LobbyPage({
  room,
  viewerSeatId,
}: {
  room: RoomView;
  viewerSeatId: SeatId;
}) {
  const occupied = room.seats.filter((seat) => seat.occupant !== null).length;
  const self = room.seats.find((seat) => seat.seatId === viewerSeatId)?.occupant;
  return (
    <main className="lobby-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">ORBIT / 等待房间</p>
          <h1>朋友到齐，就开一手。</h1>
        </div>
        <span className="occupancy" data-testid="lobby-occupancy">
          {occupied} / {room.capacity}
        </span>
      </header>
      <div className="room-code">
        <span>示例房间码</span>
        <strong>{room.roomCode}</strong>
        <small>示例码，不能用于加入</small>
      </div>
      <section className="lobby-status" data-testid="lobby-status" aria-label="开局条件">
        <strong>
          {room.canStart
            ? '满足人数条件，已准备就绪'
            : room.startBlockReasons.map((reason) => reasons[reason]).join('；')}
        </strong>
        <p>至少两名参与者即可，无需坐满四人。所有操作暂未开放。</p>
      </section>
      <section className="lobby-seats" data-testid="lobby-seats" aria-label="房间座位">
        {room.seats.map((seat) => (
          <PlayerSeat key={seat.seatId} seat={seat} self={seat.seatId === viewerSeatId} />
        ))}
      </section>
      <div className="lobby-actions">
        <button type="button" disabled>
          {self?.ready ? '取消准备' : '准备'}
        </button>
        <button type="button" disabled>
          离开房间
        </button>
        {self?.isHost && (
          <>
            <button type="button" disabled className="primary">
              开始对局
            </button>
            <button type="button" disabled>
              添加电脑
            </button>
            <button type="button" disabled>
              调整容量
            </button>
          </>
        )}
      </div>
      <p className="preview-note">灰盒预览，暂不可操作。固定数据不会创建真实房间。</p>
    </main>
  );
}

import type { RoomView } from '@orbit/protocol';
import Avatar from '../../components/Avatar';
const admission = {
  active: '可参与',
  waitingNextHand: '下一手加入',
  eliminated: '筹码已归零',
  leaving: '本手结束后离开',
};
export default function SeatList({ room, selfId }: { room: RoomView; selfId: string | null }) {
  return (
    <ol className="live-seats" data-testid="lobby-seats">
      {room.seats.map((s) => (
        <li key={s.seatId} data-testid={'seat-' + s.seatId}>
          <span className="seat-number">座位 {s.seatId + 1}</span>
          {s.occupant ? (
            <>
              <h2 title={s.occupant.nickname}>
                <span className="seat-avatar" aria-hidden="true">
                  <Avatar kind={s.occupant.kind} seat={s.seatId} />
                </span>
                {s.occupant.nickname}
                {s.occupant.participantId === selfId && <span className="self-label">你</span>}
              </h2>
              <p>
                {s.occupant.kind === 'bot'
                  ? '电脑 · ' + (s.occupant.difficulty === 'basic' ? '入门' : '标准')
                  : '真人' + (s.occupant.isHost ? ' · 房主' : '')}
              </p>
              <strong className="seat-stack">
                {s.occupant.stack.toLocaleString('en-US')} <small>筹码</small>
              </strong>
              <p>
                {s.occupant.kind === 'human'
                  ? (s.occupant.online ? '在线' : '离线保座中') +
                    ' · ' +
                    (s.occupant.ready ? '已准备' : '未准备')
                  : '无需准备'}{' '}
                · {admission[s.occupant.admission]}
              </p>
            </>
          ) : (
            <>
              <h2>{s.availability === 'open' ? '空座' : '此容量不开放'}</h2>
              <p>{s.availability === 'open' ? '可邀请朋友或添加电脑' : '调整容量后可用'}</p>
            </>
          )}
        </li>
      ))}
    </ol>
  );
}

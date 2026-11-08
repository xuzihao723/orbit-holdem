import type { PublicSeatView, HandSeatView, HandPublicState } from '@orbit/protocol';
import type { TableSeatIdentity } from './table-display.types';
import Avatar from '../../components/Avatar';
export default function PlayerSeat({
  seat,
  identity,
  hand,
  player,
  self = false,
}: {
  seat?: PublicSeatView;
  identity?: TableSeatIdentity;
  hand?: Pick<
    HandPublicState,
    'actorSeatId' | 'dealerSeatId' | 'smallBlindSeatId' | 'bigBlindSeatId'
  >;
  player?: HandSeatView;
  self?: boolean;
}) {
  const occupant = identity ?? seat?.occupant;
  const seatId = identity?.seatId ?? seat!.seatId;
  if (!occupant)
    return (
      <div className="empty-seat">
        <span>座位 {seatId + 1}</span>
        <strong>{seat?.availability === 'open' ? '空座 · 可加入' : '此容量不开放'}</strong>
      </div>
    );
  const actor = hand?.actorSeatId === seatId;
  return (
    <div
      className={`player-seat ${actor ? 'acting' : ''} ${self ? 'is-self' : ''}`}
      data-seat-id={seatId}
    >
      <span className="seat-avatar" aria-hidden="true">
        {occupant.kind ? <Avatar kind={occupant.kind} seat={seatId} /> : seatId + 1}
      </span>
      <div className="seat-info">
        <strong className="nickname" title={occupant.nickname}>
          {occupant.nickname}
          {self ? ' · 你' : ''}
        </strong>
        <span className="seat-stack">
          {(player?.stack ?? occupant.stack).toLocaleString('en-US')} <small>筹码</small>
        </span>
        <span className="seat-status">
          {occupant.kind === 'bot'
            ? `电脑 · ${occupant.difficulty === 'basic' ? '入门' : '标准'}`
            : occupant.kind === 'human'
              ? '真人'
              : '历史座位'}
          {occupant.isHost ? ' · 房主' : ''}
          {occupant.admission === 'waitingNextHand'
            ? ' · 下一手加入'
            : occupant.admission === 'eliminated'
              ? ' · 已出局'
              : ''}
          {occupant.online === false
            ? ' · 离线'
            : hand
              ? player?.folded
                ? ' · 已弃牌'
                : player?.allIn
                  ? ' · 已全押'
                  : actor
                    ? ' · 行动中'
                    : ''
              : occupant.kind === 'bot'
                ? ' · 无需准备'
                : occupant.ready
                  ? ' · 已准备'
                  : ' · 未准备'}
          {!hand && occupant.online ? ' · 在线' : ''}
        </span>
        {hand && (
          <span className="seat-badges" aria-label="位置标记">
            {hand.dealerSeatId === seatId && <span>D</span>}
            {hand.smallBlindSeatId === seatId && <span>SB</span>}
            {hand.bigBlindSeatId === seatId && <span>BB</span>}
          </span>
        )}
      </div>
    </div>
  );
}

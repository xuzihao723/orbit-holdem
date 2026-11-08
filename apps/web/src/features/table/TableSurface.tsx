import type { HandPhase } from '@orbit/protocol';
import type { TableDisplayProps } from './table-display.types';
import { getSeatPlacements } from './seat-layout';
import PlayingCard from '../../components/cards/PlayingCard';
import CardBack from '../../components/cards/CardBack';
import CardSlot from '../../components/cards/CardSlot';
import PlayerSeat from './PlayerSeat';
import TurnTimer from './TurnTimer';
const phases: Record<HandPhase | 'interrupted', string> = {
  preflop: '翻牌前',
  flop: '翻牌',
  turn: '转牌',
  river: '河牌',
  showdown: '摊牌',
  settled: '结算',
  interrupted: '已中止',
};
export default function TableSurface(table: TableDisplayProps) {
  const { seats, hand, self, viewerSeatId } = table;
  const compact = table.live === true;
  const placements = getSeatPlacements(
    hand.players.map((player) => player.seatId),
    viewerSeatId,
  );
  const ownPlayer = hand.players.find((player) => player.seatId === viewerSeatId);
  const participating = !!self && !!ownPlayer;
  const actor = seats.find((seat) => seat.seatId === hand.actorSeatId);
  const message =
    hand.phase === 'settled' || hand.phase === 'interrupted'
      ? '行动已结束'
      : table.replay
        ? actor
          ? actor.nickname + '行动'
          : '按时间轴查看'
        : table.connection === 'disconnected'
          ? '已离线，等待恢复'
          : !participating
            ? '下一手加入'
            : ownPlayer?.allIn
              ? '已全押，等待本手结果'
              : ownPlayer?.folded
                ? '已弃牌，等待本手结束'
                : hand.actorSeatId === viewerSeatId
                  ? '轮到你行动'
                  : `等待${actor?.nickname ?? '其他玩家'}行动`;
  return (
    <div className="table-scene" data-testid="table-scene">
      <div className={`table-felt players-${hand.players.length}`}>
        {placements
          .filter((placement) => placement.position !== 'self')
          .map((placement) => {
            const seat = seats.find((seat) => seat.seatId === placement.seatId);
            const player = hand.players.find((player) => player.seatId === placement.seatId);
            if (!seat || !player) return null;
            const revealed = hand.showdownCards.find(
              (cards) => cards.participantId === player.participantId,
            );
            return (
              <section
                key={seat.seatId}
                className={`opponent position-${placement.position}`}
                data-testid="opponent-seat"
                aria-label={`座位${seat.seatId + 1}`}
              >
                <PlayerSeat identity={seat} hand={hand} player={player} />
                <div className="opponent-cards">
                  {revealed
                    ? revealed.cards.map((card) => (
                        <PlayingCard key={card} card={card} compact={compact} />
                      ))
                    : Array.from({ length: player.hiddenCardCount }, (_, index) => (
                        <CardBack key={index} />
                      ))}
                </div>
              </section>
            );
          })}
        <section className="community-zone" aria-label="公共桌面">
          <div className="street-status">
            <span>{phases[hand.phase]}</span>
            <strong>{message}</strong>
            {hand.phase === 'settled' ? (
              <span>本手已结束</span>
            ) : hand.phase === 'interrupted' ? (
              <span>本手已中止</span>
            ) : table.replay ? (
              <span>回放</span>
            ) : (
              <span className="turn-indicator">
                <TurnTimer seconds={table.remainingSeconds} />
              </span>
            )}
            {!table.live && <span>静态示意</span>}
          </div>
          <p className="pot-total">
            底池 <strong>{hand.potTotal.toLocaleString('en-US')}</strong>
            <span>虚拟筹码</span>
          </p>
          <div className="community-cards" data-testid="community-cards">
            {Array.from({ length: 5 }, (_, index) => {
              const card = hand.board[index];
              return card ? (
                <PlayingCard key={index} card={card} compact={compact} />
              ) : (
                <CardSlot key={index} compact={compact} />
              );
            })}
          </div>
        </section>
      </div>
      <section className="self-zone" aria-label="本人座位">
        {participating && self.holeCards ? (
          <>
            <div className="self-cards" data-testid="self-cards">
              {self.holeCards.map((card) => (
                <PlayingCard
                  key={card}
                  card={card}
                  compact={compact}
                  fluid={compact && !table.replay}
                />
              ))}
            </div>
            <div className="self-description">
              <strong>你的底牌</strong>
              <span>仅本人可见</span>
              <span className="self-stack">
                {ownPlayer.stack.toLocaleString('en-US')} <small>筹码</small>
              </span>
              <span className="self-markers">
                {hand.dealerSeatId === viewerSeatId ? 'D · ' : ''}
                {hand.smallBlindSeatId === viewerSeatId ? 'SB · ' : ''}
                {hand.bigBlindSeatId === viewerSeatId ? 'BB · ' : ''}座位 {(viewerSeatId ?? 0) + 1}
              </span>
            </div>
          </>
        ) : (
          <p className="next-hand">{participating ? '等待发牌' : '下一手加入'}</p>
        )}
      </section>
    </div>
  );
}

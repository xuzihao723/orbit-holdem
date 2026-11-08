import { useState } from 'react';
import type {
  HandResult,
  HandSeatView,
  LegalActionsView,
  PublicSeatView,
  ReplayView,
} from '@orbit/protocol';
import CardBack from '../components/cards/CardBack';
import CardSlot from '../components/cards/CardSlot';
import PlayingCard from '../components/cards/PlayingCard';
import ActionBar from '../features/table/ActionBar';
import PlayerSeat from '../features/table/PlayerSeat';
import PotSummary from '../features/table/PotSummary';
import TurnTimer from '../features/table/TurnTimer';
import ReplayControls from '../features/replay/ReplayControls';
import { useReplayPlayer } from '../features/replay/use-replay-player';
import './component-preview.css';

const player: HandSeatView = {
  participantId: 'sample',
  seatId: 0,
  stack: 1920,
  streetCommitted: 40,
  handCommitted: 80,
  folded: false,
  allIn: false,
  hiddenCardCount: 2,
};
const positions = {
  actorSeatId: 0,
  dealerSeatId: 1,
  smallBlindSeatId: 1,
  bigBlindSeatId: 0,
} as const;
const human = {
  participantId: 'sample',
  nickname: '轨道试读玩家十二字',
  stack: 1920,
  admission: 'active',
  kind: 'human',
  difficulty: null,
  online: true,
  ready: false,
  isHost: false,
} as const;
const seat = (
  patch:
    | Partial<typeof human>
    | { ready?: boolean; online?: boolean; admission?: 'waitingNextHand' | 'eliminated' },
): PublicSeatView => ({
  seatId: 0,
  availability: 'occupied',
  occupant: { ...human, ...patch },
});
const bot: PublicSeatView = {
  seatId: 1,
  availability: 'occupied',
  occupant: {
    ...human,
    kind: 'bot',
    difficulty: 'standard',
    ready: null,
    online: true,
    isHost: false,
  },
};
const empty: PublicSeatView = { seatId: 2, availability: 'open', occupant: null };
const legal: LegalActionsView = {
  allowed: ['fold', 'call', 'raise', 'allIn'],
  callAmount: 20,
  minRaiseTo: 60,
  maxRaiseTo: 2000,
  allIn: { raiseTo: 2000, additionalAmount: 1960, kind: 'raise' },
};
const short: LegalActionsView = {
  allowed: ['fold', 'call', 'allIn'],
  callAmount: 20,
  minRaiseTo: null,
  maxRaiseTo: null,
  allIn: { raiseTo: 70, additionalAmount: 30, kind: 'raise' },
};
const callOnly: LegalActionsView = {
  allowed: ['fold', 'call'],
  callAmount: 20,
  minRaiseTo: null,
  maxRaiseTo: null,
  allIn: null,
};
const board: HandResult['board'] = ['7H', '8H', '9H', '10H', 'JH'];
const result: HandResult = {
  roomId: 'sample-room',
  matchId: 'sample-match',
  handId: 'sample-hand',
  handVersion: 5,
  phase: 'settled',
  board,
  showdownCards: [],
  pots: [
    {
      potId: 'main',
      amount: 300,
      eligibleParticipantIds: ['甲', '乙', '丙'],
      winnerParticipantIds: ['甲'],
      allocations: [{ participantId: '甲', amount: 300 }],
      winningCategory: 8,
    },
    {
      potId: 'side',
      amount: 300,
      eligibleParticipantIds: ['乙', '丙'],
      winnerParticipantIds: ['乙'],
      allocations: [{ participantId: '乙', amount: 300 }],
      winningCategory: 5,
    },
  ],
  refunds: [{ participantId: '丙', amount: 150 }],
  finalStacks: [],
  reason: 'showdown',
};
const preflop = {
  roomId: result.roomId,
  matchId: result.matchId,
  handId: result.handId,
  handVersion: 1,
  phase: 'preflop',
  ...positions,
  players: [player],
  board: [],
  showdownCards: [],
  pots: [],
  potTotal: 30,
  publicEventSequence: 0,
} as const;
const replay: ReplayView = {
  protocolVersion: 1,
  requestId: 'sample-request',
  ok: true,
  serverEpoch: 'sample-epoch',
  serverTime: 0,
  handId: result.handId,
  viewerParticipantId: 'sample',
  frames: [
    {
      sequence: 0,
      at: 0,
      actionText: '本手开始',
      state: { ...preflop, players: [player], board: [], showdownCards: [], pots: [] },
      ownerHoleCards: ['AS', 'QS'],
    },
    {
      sequence: 4,
      at: 1,
      actionText: '本手结算',
      state: {
        ...preflop,
        handVersion: 5,
        phase: 'settled',
        players: [player],
        board,
        showdownCards: [],
        pots: result.pots,
        actorSeatId: null,
        potTotal: 0,
        publicEventSequence: 4,
      },
      ownerHoleCards: ['AS', 'QS'],
    },
  ],
  stageStarts: [
    { phase: 'preflop', sequence: 0 },
    { phase: 'settled', sequence: 4 },
  ],
  result,
};
const modes = {
  normal: '正常可加注',
  short: '短额全押',
  call: '无加注权',
  pending: '提交中',
} as const;
type Mode = keyof typeof modes;

export default function ComponentPreviewPage() {
  const [mode, setMode] = useState<Mode>('normal');
  const [notice, setNotice] = useState('');
  const { player: playback, state } = useReplayPlayer(replay.frames);
  return (
    <main
      className="app-page component-state-board"
      data-preview-source="W35_DEV_COMPONENT_STATES_ONLY"
    >
      <a href="/">返回首页</a>
      <h1>组件状态校对</h1>
      <p>固定示例用于检查显示和键盘操作。金额与动作仅在此页演示。</p>
      <section aria-labelledby="preview-seats">
        <h2 id="preview-seats">座位</h2>
        <div className="preview-seats">
          <PlayerSeat seat={empty} />
          <PlayerSeat seat={seat({ ready: true })} />
          <PlayerSeat seat={bot} />
          <PlayerSeat seat={seat({})} hand={positions} player={player} self />
          <PlayerSeat seat={seat({})} hand={positions} player={{ ...player, folded: true }} />
          <PlayerSeat
            seat={seat({})}
            hand={positions}
            player={{ ...player, allIn: true, stack: 0 }}
          />
          <PlayerSeat seat={seat({ online: false })} hand={positions} player={player} />
          <PlayerSeat
            seat={seat({ admission: 'waitingNextHand' })}
            hand={{ ...positions, actorSeatId: null }}
          />
          <PlayerSeat
            seat={seat({ admission: 'eliminated' })}
            hand={{ ...positions, actorSeatId: null }}
          />
        </div>
      </section>
      <section aria-labelledby="preview-cards">
        <h2 id="preview-cards">卡面</h2>
        <div className="preview-cards">
          <figure>
            <PlayingCard card="AS" />
            <figcaption>正面</figcaption>
          </figure>
          <figure className="preview-selected">
            <PlayingCard card="7H" />
            <figcaption>选中</figcaption>
          </figure>
          <figure className="preview-best">
            <PlayingCard card="JH" />
            <figcaption>最佳五张标记</figcaption>
          </figure>
          <figure>
            <PlayingCard card="QD" />
            <figcaption>已公开</figcaption>
          </figure>
          <figure>
            <CardBack />
            <figcaption>私有牌背</figcaption>
          </figure>
          <figure>
            <CardSlot />
            <figcaption>公共牌槽</figcaption>
          </figure>
        </div>
      </section>
      <section aria-labelledby="preview-timers">
        <h2 id="preview-timers">计时</h2>
        <dl className="preview-timers">
          {(
            [
              ['普通', 23],
              ['低于十秒', 8],
              ['到期', 0],
              ['连接未知', null],
            ] as const
          ).map(([label, seconds]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>
                <TurnTimer seconds={seconds} />
              </dd>
            </div>
          ))}
        </dl>
      </section>
      <section aria-labelledby="preview-actions">
        <h2 id="preview-actions">下注</h2>
        <label>
          下注状态{' '}
          <select
            value={mode}
            onChange={(e) => {
              setMode(e.target.value as Mode);
              setNotice('');
            }}
          >
            {Object.entries(modes).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <ActionBar
          legal={mode === 'short' ? short : mode === 'call' ? callOnly : legal}
          message={modes[mode]}
          committed={40}
          stack={mode === 'short' ? 30 : 1960}
          disabled={mode === 'pending'}
          actionId={mode}
          onAction={() => setNotice('本次操作仅更新预览提示。')}
        />
        {notice && <p role="status">{notice}</p>}
      </section>
      <section aria-labelledby="preview-pots">
        <h2 id="preview-pots">结算 · 总池 600</h2>
        <PotSummary result={result} label={(id) => '座位 ' + id} />
      </section>
      <section aria-labelledby="preview-replay">
        <h2 id="preview-replay">回放</h2>
        <ReplayControls
          view={replay}
          player={playback}
          index={state.index}
          playing={state.playing}
        />
        <p role="status">正在读取授权回放…</p>
        <p role="alert">此身份无法查看该记录。</p>
      </section>
    </main>
  );
}

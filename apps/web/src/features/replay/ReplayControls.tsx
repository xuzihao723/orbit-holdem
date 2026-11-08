import type { ReplayView } from '@orbit/protocol';
import type { createReplayPlayer } from './replay-player';
export default function ReplayControls({
  view,
  player,
  index,
  playing,
}: {
  view: ReplayView;
  player: ReturnType<typeof createReplayPlayer>;
  index: number;
  playing: boolean;
}) {
  return (
    <section className="replay-controls" aria-label="回放控制">
      <div className="control-row">
        <button onClick={player.first} disabled={index === 0}>
          首步
        </button>
        <button onClick={player.previous} disabled={index === 0}>
          上一步
        </button>
        <button
          onClick={playing ? player.pause : player.play}
          disabled={!playing && index === view.frames.length - 1}
        >
          {playing ? '暂停' : '播放'}
        </button>
        <button onClick={player.next} disabled={index === view.frames.length - 1}>
          下一步
        </button>
        <button onClick={player.last} disabled={index === view.frames.length - 1}>
          末步
        </button>
      </div>
      <label>
        时间轴
        <input
          aria-label="回放时间轴"
          type="range"
          min={0}
          max={view.frames.length - 1}
          step={1}
          value={index}
          onChange={(e) => player.seekIndex(Number(e.target.value))}
        />
      </label>
      <label>
        跳转阶段
        <select
          aria-label="跳转阶段"
          value={view.frames[index]!.state.phase}
          onChange={(e) => {
            const stage = view.stageStarts.find((s) => s.phase === e.target.value);
            if (stage) player.seekSequence(stage.sequence);
          }}
        >
          {view.stageStarts.map((s) => (
            <option key={s.phase} value={s.phase}>
              {
                {
                  preflop: '翻牌前',
                  flop: '翻牌',
                  turn: '转牌',
                  river: '河牌',
                  showdown: '摊牌',
                  settled: '结算',
                  interrupted: '中止',
                }[s.phase]
              }
            </option>
          ))}
        </select>
      </label>
      <p role="status">
        {index + 1} / {view.frames.length} · 事件 {view.frames[index]!.sequence} ·{' '}
        {view.frames[index]!.actionText}
      </p>
    </section>
  );
}

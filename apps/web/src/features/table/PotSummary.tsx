import type { HandResult } from '@orbit/protocol';
const category = ['高牌', '一对', '两对', '三条', '顺子', '同花', '葫芦', '四条', '同花顺'];
export default function PotSummary({
  result,
  label,
}: {
  result: HandResult;
  label: (id: string) => string;
}) {
  return (
    <div className="pot-summary">
      <p>{result.reason === 'allOthersFolded' ? '其余玩家弃牌' : '摊牌结算'}</p>
      {result.pots.map((pot, i) => (
        <section key={pot.potId}>
          <h3>
            {i === 0 ? '主池' : '边池 ' + i} · {pot.amount}
          </h3>
          <p>有资格：{pot.eligibleParticipantIds.map(label).join('、')}</p>
          {pot.winningCategory !== null && <p>获胜牌型：{category[pot.winningCategory]}</p>}
          <ul>
            {pot.allocations.map((a) => (
              <li key={a.participantId}>
                {label(a.participantId)} 获得 {a.amount}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {result.refunds.length > 0 && (
        <section>
          <h3>未匹配下注返还</h3>
          <ul>
            {result.refunds.map((r) => (
              <li key={r.participantId}>
                {label(r.participantId)} 退回 {r.amount}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

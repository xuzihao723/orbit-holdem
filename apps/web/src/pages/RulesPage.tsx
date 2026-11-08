import { HAND_RANK_EXAMPLES } from '../features/rules/hand-rank-examples';
import PlayingCard from '../components/cards/PlayingCard';
export default function RulesPage() {
  return (
    <main className="app-page rules-page">
      <a href="/">返回首页</a>
      <p className="eyebrow">ORBIT / 玩法说明</p>
      <h1>先认牌，再读懂一手。</h1>
      <p className="page-lead">
        2张底牌与5张公共牌中选最佳5张。花色不分胜负，A可作五高顺子的低牌。
      </p>
      <ol className="rank-list">
        {HAND_RANK_EXAMPLES.map((e) => (
          <li key={e.name}>
            <h2>{e.name}</h2>
            <div className="rule-cards">
              {e.cards.map((c) => (
                <PlayingCard card={c} key={c} compact />
              ))}
            </div>
          </li>
        ))}
      </ol>
      <section className="rules-copy">
        <h2>金额与底池</h2>
        <p>“加注至100”指本轮累计投入100。若已投入20，本次再支付80。跟注最多支付手中剩余筹码。</p>
        <p>
          短额全押可能不会重新开放其他人的加注权。边池只由有资格的参与者争夺；未匹配的超额投入先退回，平分时余数按按钮后的座位顺序分配。
        </p>
        <h2>同桌与恢复</h2>
        <p>
          每人入场2,000虚拟筹码，小盲10、大盲20。至少2名参与者，无需坐满4人；每手结束后真人重新准备。
        </p>
        <p>
          行动期限30秒，超时有免费过牌则过牌，否则弃牌。断线保座120秒；全押后退出仍参加本手结算，再按边界离开。
        </p>
        <p>服务器重启会中止未结束的一手，不恢复继续下注。访客凭据丢失后无法找回原身份。</p>
        <h2>当前开放范围</h2>
        <p>
          已开放创建、加入、准备、正式下注和逐池结算。每手结束重新准备，由房主开始下一手；本人参赛历史与逐步回放已开放。
        </p>
      </section>
      <a href="/">返回首页</a>
    </main>
  );
}

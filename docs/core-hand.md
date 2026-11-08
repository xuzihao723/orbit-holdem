# 完整单手状态机

W12把W05发牌、W07盲注位置、W09下注轮和W11结算组合为createHand、getHandLegalActions、applyHandAction、advanceHand。核心不读取时钟、网络、数据库或系统随机数；外部注入handId、participantId、庄家、初始筹码及完整洗好牌序。

HandState.players是筹码和底牌的唯一权威。startingStack是扣盲注前的历史基准；betting只保留轮元数据，临时投影BettingRound后按seatId合并。deck保留W05游标，board和burnCards分别记录已发公共牌与内部烧牌。

createHand建立version1。成功公共动作和随后自动翻街/跑牌/结算是一份原子候选，只增长一次handVersion。每个新决策增加turnSerial，turnId为handId:turn:serial；同一玩家到下一街也换ID。事件sequence连续，携带候选版本。拒绝与settled空推进返回原state、无事件，不改变筹码或计数；公开返回包装冻结。

下注轮continue产生决策；streetComplete清街道贡献并烧牌翻街；runout先退未匹配段再一次跑完剩余公共牌；uncontested直接结算。唯一有筹码者仍欠额时必须先回应，不提前跑牌。自动推进有界，无空行动循环。早退金额从贡献扣除后，最终结算只处理余下贡献；result累计展示退款，不再加钱。

终态phase=settled、betting/turnId=null、贡献0、settlementCount=1。holeDealt为owner事件，烧牌为internal，摊牌只含未弃玩家；HandState含私有牌序，不能直接当网络快照。W20负责协议视图映射。

S01实际重放2/3/4人并消耗12/14/16张；S02弃牌、S03跑牌、S04真实可达欠额轨迹、S05真实终态重复推进均在测试与轨迹中留证。hand-internal.ts集中计数和深冻结，为计划文件分工的实际细化。

[W12验收](verification/w12.md) · [规则覆盖](verification/core.md)

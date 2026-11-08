# 准备、管理与真实开手

W18支持ready、capacity、bot add/remove、reset propose/cancel及start。实际变更清真人准备，同值和duplicate不重复清。容量是占用数、不重编号；电脑有basic/standard实体和免准备字段，尚无自动策略。

canStart由startConditions计算。正常waiting/betweenHands要求2—capacity个active正筹码参赛者，真人在线准备、房主在线、边界已处理；零筹码者不入普通下一手。matchFinished只能有提议且全体入座真人（含零筹码）在线同意后重开。提议不充值，最终start在同事务结束旧场、创建新场、移除旧余额、统一2000、记台账、开新手，participantId不变。

使用服务器crypto安全洗牌和首庄，后手根据上手participant身份而非复用seat决定continuedSeatIds。固定牌序仅为服务端测试依赖，公网无seed/deck入口。createHand后断言不变量，冻结正筹码参加名单；初始版本1与事件序号连续。初始短盲可自动跑牌结算，不强制保持playing。

RoomCommit写管理图，HandStartCommit写场/资金/名单/位置/手/owner事件/收据。逐座校对起始筹码与增减账，再按盲注/退款/派奖事件核对余额。烧牌只存count1，完整牌序不落库。Native结果严格允许字段，实时public pot为sum贡献、pots保守为空；结算实时pot0/[]，历史各池留HandResult。

schema2增加ready/bot_difficulty/reset_proposal_json，001原字节保留；0/1/2原结构均先校验，升级后指纹在事务内校验，不把失败迁移提交。dist复制001和002，缺任一文件构建失败。v1数据/会话/电脑升级保留。

deadline暂null，W21接30秒；W22恢复保座/中止，W23完整手间待加入/退出，W24—28电脑自动决策。当前未接前端正式按钮。

[W18验收](verification/w18.md) · [房间基础](rooms.md)


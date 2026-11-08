# 电脑观察与可信动作

W24（2026-11-01）建立安全接口，未实现自动策略或调度。BotObservation仅显式复制本人底牌、公共牌/座位/投入、合法动作、期限与最近64条公开actionApplied摘要。观察只给仍入座的active、未弃牌未全押当前bot actor；无turn/deadline、暂停或关闭时为null。

DTO逐层复制冻结，不引用RoomState、HandState、deck、burnCards、对手牌、session或洗牌随机源。publicActions在规则候选生成，但只随SQL成功后的store.replace生效，新手清空。PRIV04使用同标识/本人牌/公共状态的两份完整合法core构造，替换对手牌与未来牌后观察和固定测试流的意图一致。

策略意图经adaptBotIntent：允许的无金额动作保留；bet/raise有限非负安全整数裁到合法区间；非法/空区间/无重开权回退check，否则fold，否则null。不会自动call或用allIn绕过raise权。最终仍由真实规则验证。

botActionCommand只构造内部DTO，executeBotAction进入共享房间队列，再核对bot/participant/冻结seat/actor/手/turn/version/deadline。bot:botId作用域及固定bot:handId:turnId收据；同意图重复返回原结果，变意图暂停且不再执行。无socket、伪访客或公网bot事件，普通真人不能替bot下注。事件/筹码/收据用既有HandActionCommit同事务提交后才替换内存和发布；存储失败无候选泄漏，关闭后旧意图丢弃。

W25加入basic纯策略及延迟调度；W26采样内核、W27线程后才开放实时standard。

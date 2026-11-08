# W08 / W09 下注接口

共享只读类型在 `betting-types.ts`。`betting.ts` 是公开门面，金额在 `betting-amounts.ts`，完整轮调度在 `betting-round.ts`；后者直接依赖金额模块，避免门面循环导入。核心不依赖protocol、Node、网络或系统时间；协议兼容仅在编译测试中证明。

金额均为非负安全整数，手累计贡献已包含本轮贡献。raiseTo表示本轮累计额，追加额为raiseTo减去原streetCommitted；不能再把streetCommitted重复加进手累计或底池。

`getLegalActions(round,seat)` 仅向当前actor返回动作。callAmount保留名义差额，可大于余额；不足或恰好全部余额的跟注必须显式allIn。普通bet/raise要求完整最小额，短额全押不伪造普通加注区间。没有重开权或没有其他可下注者时不能主动提高标线。未知/非actor查询返回空动作。

逐玩家重开资格：lastActedAtBet=null，或者currentBet−lastActedAtBet≥lastFullRaiseSize。完整加注更新lastFullRaiseSize，短全押只提高currentBet。资格还需与“存在未弃牌、未全押且有筹码的响应对手”共同判断。

`applyBettingAmount(round,seat,unknownAction)` 严格验证自身type字段、普通对象、恰好允许的字段、安全整数金额。错误回合优先NOT_YOUR_TURN；金额非法为ILLEGAL_AMOUNT，意图/结构/权利非法为ILLEGAL_ACTION。失败返回原round同引用且不改嵌套数据；成功只返回冻结BettingEffect，保留旧lastActedAtBet，**没有下一actor或pending**。测试静态拒绝Effect赋为BettingRound。

`beginBettingRound({street,bigBlind:20,players,actionOrder})` 翻前接W07实扣盲注并保留名义20；翻后清streetCommitted和行动基准，保留handCommitted/弃牌/全押。输入完整环包含全部本手参与者。多个可行动者都需初次选择；仅一人有筹码时只保留尚欠差额的回应。

`applyBettingAction` 调用金额函数一次，记录实际行动者动作完成后的currentBet为lastActedAtBet；其他人的历史不变。任何加高标线都把仍欠额者重新放回pending，完整加注要求其他可行动者回应。按完整行动环最多循环一周选择下一actor。不能因金额已相等就删掉尚未选择的大盲。

成功返回完整冻结state、金额effect及信号：continue / streetComplete / runout / uncontested。最后一名未弃牌者优先uncontested；至少两人未弃牌但不足两人继续下注时，必须先解决仍欠名义差额，再runout。零存活者、损坏队列和遗漏回应者抛INVALID_BETTING_STATE。

B03—B07既读取冻结快照，也从街道起点运行实际动作；B03/B12直接解码原history。B07原快照中已弃D的lastActed为null，而W09约定实际fold记录标线10；测试保留原快照，对真实历史核对全部金额/状态和未弃者基准，同时独立断言fold历史为10。原JSON未修改。

这些信号不发牌、不生成turnId、不修改网络版本、不派奖；W12负责组合。[W08验证](verification/w08.md)、[W09验证](verification/w09.md)

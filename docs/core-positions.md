# W07 位置、盲注与行动环

逻辑座位复用SeatId 0—3，只接收本手2—4名参与者。`chooseFirstDealer` 对排序后的座位调用一次注入随机源并验证范围。`resolvePositions` 返回庄家、小盲、大盲、两圈发牌顺序和翻前/翻后完整行动环；输出冻结，输入顺序不影响结果。

多人小盲是庄家之后第一位，大盲是下一位；翻前从大盲后开始，翻后从庄家后开始。双人庄家兼小盲，另一位是大盲且先获牌；庄家先做翻前动作，大盲先做翻后动作。

`resolveNextPositions(previous,nextSeatIds)` 默认顺时针寻找新庄家。多人转双人且旧大盲确实继续参赛时，旧大盲成为新庄家/小盲；自然双人交替。`continuedSeatIds` 由未来上层验证参与者身份后明确传入，不能把同座替换的新参与者当成原大盲。

`postBlinds(players,positions)` 扣实际 `min(stack,10/20)`，不足者标allIn；无论实际短盲多少，名义currentBet和lastFullRaiseSize仍为20。记录初始总筹码和实扣potTotal，所有lastActedAtBet=null，强制盲注不算自愿行动。

`getActionOrder` 使用完整位置环过滤弃牌、全押和零筹码者；完整环交W09，不能长期用过滤后的环代替。O05在W07只证明盲注不算行动，W08证明合法动作，W09证明大盲选择仍在队列。[W07验证](verification/w07.md)

# M1规则封板与覆盖索引

日期：2026-10-31。W05—W13规则阶段完成；最终W15回归214项core全通过，原固定材料未改。M1完成，M2联机仍未完成。

| 原场景 | 原operation | 实际入口/证据 |
|---|---|---|
| C01—C03 | createDeck / dealThroughRiverVariants / shuffleTwiceWithFreshIdenticalStub | [W05](w05.md)：52牌、双圈发牌、3次烧牌、12/14/16消耗与随机接口 |
| E01—E07、RANK01—RANK04 | evaluateBest / comparePlayers / compareHands / evaluateInvalidInputs | [W06](w06.md)：九牌型、A低顺、踢脚、跨玩家平局；独立牌力对照 |
| O01—O05 | resolvePositions / resolveNextHandPositions / postBlinds / getLegalActions | [W07](w07.md)：双人与多人位置、转双人、短盲名义线及BB机会 |
| B01—B12 | getLegalActions / getLegalActionsAndApply / applyActionVariants / applyInvalidRaises / applyAction | [W08](w08.md)金额和[W09](w09.md)真实下注历史、短全押与逐人重新加注权 |
| P01—P07 | buildAndAwardPots | [W10](w10.md)退款/池层＋[W11](w11.md)逐池资格/赢家/每座奖额/余数；P06保护性输入 |
| S01—S05 | playPassiveHandVariants / playHand / advanceUntilPlayerDecision / advanceRepeatedly | [W12](w12.md)：真实固定牌序、2/3/4人轨迹、欠额不能跑牌、一次结算 |
| I01 | simulateLegalHandsAndCheckEveryStep | [W13](w13.md)：seed20261030，1000手，每手上限500，逐状态不变量 |
| I02 | generateAndRejectInvalidActions | [W13](w13.md)：seed20261031，1000次，9类全部实际可达且受控拒绝 |

测试直接读取冻结scenarios.json并验证operation；S04是原局部快照加真实可达历史，S05由真实S02终态重复推进。P05/P07原材料为向量，其他有实牌的P案例另用牌力交叉核验。模拟固定牌序及种子仅用于测试，不提供客户端生产入口。

最终[W15 core](w15-core.json)、[10,000组独立对照](w15-oracle.json)、[1000手合法](w15-legal-simulation.json)、[1000次非法](w15-invalid-simulation.json)均为本批真实运行。另有[原S01—S03编译包补验](w12-w15-compiled-hand-supplement.json)。性质检查覆盖逐座账目、各池平分与余数，防止总额守恒掩盖错分。

PRIV01—PRIV04完整隐私/电脑矩阵、真人网络2/3/4人各10手、计时/重试/恢复、电脑200手和完整UI不属于本次M1封板。W15仅验PRIV04连接接管子断言，不能将其余场景登记完成。

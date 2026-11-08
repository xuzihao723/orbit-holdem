# 逐池判胜与派奖

W11实现于纯核心的settlement.ts和settlement-types.ts，复用W06比较器与W10池层。接口由poker-core入口导出，输入输出均只读，返回数据深冻结。

- rankShowdown接收五张公共牌和各座两张底牌；验证跨玩家唯一性，返回牌力向量。
- awardContributions先返还未匹配贡献，再逐池只比较eligibleSeatIds。平局先整除，每池独立把余数从庄家左侧按四座顺时针分给并列赢家，庄家在最后。
- settleBalances在同一纯转换中把退款和奖额加到stack，同时清零hand/street贡献。校验安全整数和守恒；中途失败不写输入。

退款不是赢池收入。P03最终余额1200/1050/750；P06即使最高贡献者已弃牌仍退其未匹配200，最终1100/900。只有一人存活时不需要牌力，也不公开弃牌者底牌。重复应用同一旧输入的防护属于W12状态机，不能把无状态金额函数当成幂等命令处理器。

原P01—P07完整断言由settlement-scenarios严格读取。P01—P04/P06另用原实牌交叉核验；P05/P07只提供向量，保持原材料，不伪造牌序。

[W11验收](verification/w11.md) · [完整手](core-hand.md) · [池层](core-pots.md)

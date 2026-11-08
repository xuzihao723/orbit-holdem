# W10 未匹配返还与池层

`buildPotLayers(contributions)` 只接本手累计amount、逻辑seatId和folded。最多4个唯一座，允许空或全0输入。贡献、总额均为安全整数；原对象不变，全部输出对象、数组和元素冻结。

先在所有贡献者中查最高和次高，包含弃牌者。唯一最高者的未匹配差额退回该座；并列最高不退。P06弃牌B的300面对A的100仍退200，这与赢池无关。只有一个正贡献时全额退回。

再把调整后不同正高度升序分层：金额=(upper−lower)×达到upper的贡献者数，弃牌者的钱仍计算，但eligible只包含未弃牌贡献者。正额层没有eligible时抛NO_ELIGIBLE_PLAYER，不静默丢钱。退款＋池额＝原贡献，调整贡献总额＝池额。

adjustedContributions、contributors和eligible按seatId排序；potId为 `pot:${lowerExclusive}:${upperInclusive}`，同一手对输入排列稳定。它不是跨手全局标识，持久化还需handId。

错误分别为INVALID_CONTRIBUTION_SEATS、INVALID_CONTRIBUTION_AMOUNT、UNSAFE_CONTRIBUTION_TOTAL和NO_ELIGIBLE_PLAYER。W10返回调整贡献和退款，不自行写回玩家stack或streetCommitted。

原P01—P04/P06/P07的operation是buildAndAwardPots；本步只验证其中退款、池额、资格和守恒子断言。赢家、payout和P05余数分配继续交W11，不能把池层通过写成完整结算通过。[W10验证](verification/w10.md)

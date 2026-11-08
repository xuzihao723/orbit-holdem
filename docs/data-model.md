# W02数据模型与公开边界

版本：1.0.0｜日期：2026-10-30｜依据：[产品规则](product-rules.md)、[边界决定](decisions.md)。

本文定义对象及字段语义，不创建数据库或规则引擎。共享声明见[commands.ts](../packages/protocol/src/commands.ts)、[views.ts](../packages/protocol/src/views.ts)、[errors.ts](../packages/protocol/src/errors.ts)。W02不安装编译器，类型编译和自动契约测试交W03。

## 1. 通用字段规则

所有ID为非空字符串；commandId/requestId为UUID；版本为非负安全整数。筹码为非负安全整数，台账delta可为负；时间为Unix毫秒安全整数。null表示明确不存在，缺失字段仅在类型带`?`时允许。

逻辑牌号为S/H/C/D、2—A，10写10；CardPair恰好两张且不重复。CardId的TypeScript形式限制拼写，运行时仍须校验输入和跨位置唯一性。

ServerMeta统一含protocolVersion=1、serverEpoch、serverTime。客户端发现epoch改变时停止使用旧手缓存和未确认动作，重新认证同步；不在新epoch自动重放旧下注。

## 2. 内部实体

下表只描述内部存储模型；标注“不可公开”的字段不能靠导出整个实体供浏览器使用。

| 实体 | 字段、类型与可空性 | 生命周期与可见性 |
|---|---|---|
| Session | sessionId:string、tokenHash:string、createdAt/expiresAt:number、connectionGeneration:number | 访客身份；sessionId与expiresAt仅本人身份响应，tokenHash永不公开；代数接管时增长 |
| Room | roomId/roomCode:string、hostParticipantId:string\|null、capacity:2\|3\|4、roomVersion:number、status:RoomStatus、matchId/currentHandId:string\|null | 从创建到关闭；通过RoomView公开，内部连接集合不公开 |
| Match | matchId/roomId:string、status:active\|finished\|interrupted、lastBigBlindSeatId:SeatId\|null、startedAt:number、endedAt:number\|null | 新场生成新ID；位置用于轮转，不与房间状态合并 |
| Participant | participantId/roomId:string、sessionId:string\|null、botId:string\|null、seatId:SeatId、nickname:string、stack:number、admission:Admission、joinedAt:number、leftAt:number\|null | 同次入座可跨重开；真人sessionId/电脑botId恰有一个非null，归属身份不公开 |
| Hand | handId/matchId/roomId:string、handVersion:number、turnId:string\|null、冻结participantIds、庄家/盲注、阶段、贡献、底池、底牌与私密牌序 | 公开投影成HandPublicState；底牌/牌序不作为共同状态导出 |
| CommandReceipt | actorScope/commandId/payloadHash:string、event:string、结果、appliedRoomVersion:number\|null、handId/appliedHandVersion可空 | actorScope+commandId唯一；仅取允许字段生成确认，不发送载荷摘要或内部主体信息 |
| ChipLedger | entryId/roomId/matchId/participantId:string、type:四种台账类型、delta:number、occurredAt:number、关联commandId:string\|null | 手间增发/退出/重置；不混入单手盈利和守恒 |
| HandHistory | handId:string、参赛身份归属、status:settled\|interrupted、分级可见事件、最终结果可空 | 已完成手有结果，中止手无派彩；先授权再投影为回放 |

台账类型沿用seat_grant、seat_cashout、match_reset_remove、match_reset_grant。本轮不重新定义筹码、准备和退出规则。

## 3. 三种身份与四种版本

| 标识 | 含义 | 约束 |
|---|---|---|
| sessionId | 访客身份 | 来自认证连接，不能靠请求自报来控制玩家 |
| participantId | 一次入座 | 退出再入新建；不能从seatId推导私人历史权限 |
| seatId | 0—3顺时针位置 | 空座可存在；容量变小不重排已占座位置 |
| roomVersion | 房间公开状态版本 | RoomView可见字段变化即增长，包括成员、准备、房主、容量、阶段与同步筹码；仅重新发送相同快照不增长 |
| handVersion | 当前手规则状态版本 | 合法行动、发牌、结算等规则转换增长；重复/拒绝动作不增长 |
| turnId | 一次行动机会 | 换actor即更新；无待用户决定时为null |
| serverEpoch | 本次服务进程 | 重启改变；不与房间/手版本比较大小 |

版本不是同一计数器：加入等待者只改roomVersion；过牌可能只改handVersion；下注改变手状态及RoomView筹码时，两种版本都增长。game:action只用expectedVersion比对handVersion，不能用roomVersion拒绝当前有效下注。

不同handId的版本不能直接比较。确认中的handId/appliedHandVersion描述受到该命令影响的手，不保证它仍是当前手。

## 4. RoomView和座位

RoomView包含ServerMeta、roomId、roomCode、roomVersion、matchId、currentHandId、capacity、status、hostParticipantId、seats、canStart、startBlockReasons、resetProposal。

seats始终4项，seatId各出现一次：

- 空位：occupant=null，availability为open或capacityClosed。
- 已占：availability=occupied，occupant含participantId、nickname、stack、admission及真人/电脑字段。
- 真人：kind=human、difficulty=null、online/ready/isHost为布尔值。
- 电脑：kind=bot、difficulty=basic或standard、online=true、ready=null、isHost=false；null表示电脑不参与准备。
- open空座数量=capacity−占用数；其余空槽capacityClosed。已占seatId=3不意味着容量2时必须踢出。

Admission为waitingNextHand、active、eliminated、leaving。中途入座stack=0且waitingNextHand不能被误判eliminated。

canStart由服务端给出；startBlockReasons为允许的业务原因，不展示内部异常。重开提议存在时，ready表达新场同意；零筹码入座真人也必须同意。

## 5. 手牌公开状态和本人视图

HandPublicState包含房间/场/手ID、handVersion、phase、庄家/盲注、players、board、showdownCards、pots、potTotal、actorSeatId、turnId、deadline、publicEventSequence。

players仅冻结的本手参赛者，字段为participantId、seatId、stack、streetCommitted、handCommitted、folded、allIn、hiddenCardCount；不含任何底牌。等待者只在RoomView占座，不插入players。

board最多5张。showdownCards只含已按R06/R07公开的participantId与两张牌；弃牌未公开者不得出现。hiddenCardCount为未发/已公开时0、未公开时2，不根据牌值改变。

potTotal=sum(handCommitted)，不能再加streetCommitted或重复加pots。下注尚待回应时可以只返回总额、pots=[]；已可安全分解时返回池层且池额合计=potTotal。结算后贡献清零、potTotal=0、实时pots=[]，历史分配单独保存在HandResult。

PlayerView是ServerMeta+HandPublicState+roomVersion+self；只能点对点发送。self包含participantId、admission、holeCards:CardPair|null、legalActions。

- 已参赛本人包括已弃牌者可见本人底牌；未参赛等待者holeCards=null。
- 非当前actor、已弃牌、全押、等待者或失权连接的allowed=[]；金额区间和allIn为null，callAmount=0。
- actor的callAmount是理论跟注差额，可能大于余额；allIn.additionalAmount才是全押实际投入。UI不能因callAmount存在就启用普通call。
- minRaiseTo/maxRaiseTo仅在普通bet/raise可用时非null；只有短额allIn时通过allIn对象表达，不伪造完整区间。
- allowed没有raise时，不能以allIn的raise意图绕过限制。
- deadline是服务端原期限，失联、恢复和动画不延长；客户端显示max(0,deadline−校准服务器时间)。

## 6. 结果与历史

HandResult只含公开结算：ID/版本、phase=settled、board、showdownCards、各池资格/赢家/分配、refunds、finalStacks、reason。reason为showdown或allOthersFolded。

PotAward.winningCategory在无需公开的直接赢池时为null，不通过“赢家牌型”间接泄露未公开底牌。退款单列，不算赢池。HandResultView追加ServerMeta与roomVersion，可作game:result事件。

HistoryItem分settled与interrupted：前者endingStack、netHandChange、wonAnyPot有值；后者三者均为null，不伪造终局盈利。startingStack是扣盲注前余额，netHandChange=endingStack−startingStack，只计算手内变化。

HistoryPage含requestId、items和nextCursor。游标不透明，不可凭游标越过本人参赛权限；limit默认20、允许1—50。

ReplayView包含requestId、handId、viewerParticipantId、frames、stageStarts、result。每帧含sequence、at、actionText、只读state、ownerHoleCards；state不提供turnId、deadline或legalActions。ownerHoleCards在当时尚未发牌时为null，不能提前显示未来信息。

ReplayFrame的phase可额外为interrupted。中止回放result=null；settled结果与最后帧逐座筹码一致。对手仍只见已公开牌；回放是投影结果，不是内部事件原样下载。

## 7. 认证恢复结果

GuestIssued仅通过session:guest私有结果返回sessionId、resumeToken、expiresAt、connectionGeneration及元信息。只有此结果可携带新发行令牌。

SessionResumed不再回显令牌，包含sessionId、expiresAt、connectionGeneration及以下判别联合：

| outcome | 字段 | 意义 |
|---|---|---|
| seatRestored | participantId、roomView非null、playerView可空 | 身份和席位均恢复；若尚无手则playerView=null |
| identityOnly | reason=notSeated/seatExpired/roomClosed、两个视图均null | 身份有效，可查本人历史；原席位没有恢复 |
| handInterrupted | interruptedHandId、两个视图均null | 认证后确认原本人参赛手因重启中止，需重开 |

resume中的roomId和lastSeenHandId只用于定位/同步，必须验证其归属，不能原样回显陌生handId为已中止。令牌错误或过期返回SESSION_EXPIRED，不发任何本人视图。

## 8. 永不跨出服务端的字段

完整deck、未发牌、burnCards、其他玩家未公开底牌、botPrivateState、tokenHash、连接注册表、SQL实体、异常堆栈与收据payloadHash。

room:create/join的nickname和roomId只是输入/定位，永不等于控制权限。数据库模型与共同类型不能互相直接扩展；传输层必须按允许字段构造对象。

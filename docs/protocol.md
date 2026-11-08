# W02通信协议

版本：1.0.0｜日期：2026-10-30｜状态：契约资料已完成，类型声明尚未编译，不含实际传输实现。字段声明以[commands.ts](../packages/protocol/src/commands.ts)、[views.ts](../packages/protocol/src/views.ts)、[errors.ts](../packages/protocol/src/errors.ts)为共同基线。

规则依据：[product-rules.md](product-rules.md)。字段与公开范围见[data-model.md](data-model.md)，错误与恢复见[errors.md](errors.md)，14组样例见[examples/protocol.json](examples/protocol.json)。

## 1. 输入约定

- 结构外的未知字段拒绝，不能靠多传sessionId、seatId或私密信息获得控制权；合法的电脑管理seatId仅作目标。
- commandId与requestId为UUID字符串，分别关联业务变更与身份/查询结果。
- roomId是服务器房间ID；roomCode是6位邀请字符串，允许字符`23456789ABCDEFGHJKLMNPQRSTUVWXYZ`，规范化大写；两者都不代表身份。
- nickname去首尾空白后1—12个Unicode字素，拒绝控制字符；不得仅按UTF-16长度计算。
- capacity仅2/3/4，seatId仅0—3，difficulty为basic/standard。
- 版本、金额、limit、时间由运行时验证为安全整数；金额不允许数值字符串、小数、NaN或Infinity。
- 所有成功/失败响应和视图含protocolVersion=1、serverEpoch、serverTime；请求不携带任意协议版本切换参数。

## 2. 十五个客户端入口

“业务基类”=commandId；“房间基类”=commandId+roomId；“房间版本基类”再加expectedRoomVersion。

| 入口 | 完整载荷字段 | 认证、阶段与权限 | 结果通道和主要拒绝 |
|---|---|---|---|
| session:guest | requestId、nickname | 首次身份发行，不作为游戏命令；已认证客户端不应用晚到的guest结果覆盖现有凭据 | 私有GuestResponse；INVALID_INPUT/RATE_LIMITED |
| session:resume | requestId、resumeToken、roomId可空、lastSeenHandId可空、lastSeenRoomVersion可空、lastSeenHandVersion可空 | 验证令牌并接管；位置与版本只是提示，不授予权限 | 私有ResumeResponse；SESSION_EXPIRED |
| room:create | commandId、capacity、nickname | 已认证控制连接；创建者成为房主并入座 | command:ack后room:view；INVALID_INPUT/PERSISTENCE_UNAVAILABLE |
| room:join | commandId、roomCode、nickname | 已认证，队列内原子占座；手中可占空位等待；不能同房重复占座 | command:ack后room:view，若有当前手再发本人过滤game:view；ROOM_NOT_FOUND/ROOM_FULL |
| room:ready | 房间版本基类、ready | 本人入座、手间；重开提议下表示同意；电脑不调用 | command:ack后room:view；NOT_READY/HAND_IN_PROGRESS/STALE_STATE |
| room:capacity:set | 房间版本基类、capacity | 房主、手间；不小于占座数；清空准备，不重排seatId | command:ack后room:view；NOT_HOST/INVALID_INPUT/HAND_IN_PROGRESS |
| room:bot:add | 房间版本基类、seatId、difficulty | 房主、手间、目标空位且未满；发筹码并清空准备 | command:ack后room:view；NOT_HOST/ROOM_FULL/INVALID_INPUT |
| room:bot:remove | 房间版本基类、seatId | 房主、手间、目标电脑；移出最终余额并清空准备 | command:ack后room:view；NOT_HOST/INVALID_INPUT/HAND_IN_PROGRESS |
| room:start | 房间版本基类 | 房主在线，当前手已结束；人数、准备、离线与重开同意条件满足 | command:ack后room:view/game:view；NOT_HOST/NOT_READY/NOT_ENOUGH_PLAYERS |
| game:action | 房间基类、handId、turnId、expectedVersion、action | 已认证、属于冻结参赛者、是actor且回合/版本有效 | command:ack后game:view；NOT_YOUR_TURN/STALE_STATE/ILLEGAL_ACTION/ILLEGAL_AMOUNT |
| room:leave | 房间基类 | 本人入座；按R08即时弃牌或预约手间离开，全押保留资格 | command:ack；其他成员获得新视图，离开者获允许的最终结果；ROOM_FORBIDDEN |
| room:reset:propose | 房间版本基类 | 房主、手间；清空准备，提出新场 | command:ack后room:view；NOT_HOST/HAND_IN_PROGRESS |
| room:reset:cancel | 房间版本基类 | 房主、手间；清空同意，取消提议 | command:ack后room:view；NOT_HOST/HAND_IN_PROGRESS |
| history:list | requestId、cursor可空、limit可省略 | 已认证，仅本人参赛记录；limit默认20，1—50 | 私有HistoryResponse；SESSION_EXPIRED/INVALID_INPUT |
| replay:get | requestId、handId | 已认证，本人参赛且手已结束/中止；先授权再投影 | 私有ReplayResponse；REPLAY_FORBIDDEN/REPLAY_NOT_FOUND |

所有新房间操作检查本人在指定roomId的成员与控制权限。已认证且仍有控制权的身份可以读取自己已处理命令的收据，即使该命令已经让本人退出房间；这不授予读取退出后最新视图的权限。陌生房间的新操作使用ROOM_FORBIDDEN，不能先暴露最新版本或视图再拒绝。

## 3. 六种行动

| action | 载荷 | 金额含义 |
|---|---|---|
| fold | `{type:"fold"}` | 无金额 |
| check | `{type:"check"}` | 仅无跟注差额 |
| call | `{type:"call"}` | 服务端计算差额；余额不足/恰好全部时使用allIn表达 |
| bet | `{type:"bet",raiseTo:number}` | 尚未有下注时本轮累计开注额 |
| raise | `{type:"raise",raiseTo:number}` | 本轮累计加注至多少 |
| allIn | `{type:"allIn"}` | 服务端从剩余筹码解析累计额及跟注/下注/加注性质 |

只有bet/raise携带raiseTo，其他行动夹带金额属于未知字段。客户端不提交“本次扣款额”。例：本轮已投20、currentBet=60、完整增量40，最低加至100，追加80；跟注只需40。

## 4. 确认、去重和失败

CommandSuccess固定字段：ServerMeta、commandId、ok=true、duplicate、roomId、appliedRoomVersion、handId可空、appliedHandVersion可空。两个手字段同时非null或同时null；非null仅描述本命令影响的手，不是最新桌面快照。

CommandFailure包含ServerMeta、commandId可空、ok=false、duplicate、code、retryable、retryAfterMs可空、fieldIssues、roomId/handId可空、latestRoomVersion/latestHandVersion可空。非法关联ID时返回null，不回显任意未校验对象。

RequestFailure用requestId可空替代commandId/duplicate，其余失败字段相同。成功身份与查询通过请求对应的私有返回通道返回，不在房间广播中发送。

处理顺序：

1. 结构/速率校验、认证、控制连接代数检查，由服务器确定actorScope。
2. 按actorScope+commandId查最终收据，比较规范化请求摘要。已处理且相同则返回原结果duplicate=true，不先要求仍在房间或仍是房主；载荷不同则COMMAND_ID_CONFLICT。
3. 新命令定位房间并进入串行队列，在队列中再次查收据，避免同时抵达的重复请求都应用。
4. 只有未处理的新命令继续检查当前房间归属、权限、阶段、手、turn、版本与金额，计算候选状态。
5. 提交状态相关记录与收据；写失败不发布成功，不替换内存状态，暂停房间。
6. 提交后发布确认和允许视图；消息丢失不撤销已生效动作。重复确认附带最新视图的前提是该身份现在仍有权查看该视图。

这描述业务应用一次，不承诺网络投递恰好一次。最外层格式/认证/限速失败不作为已执行业务写入收据；通过这些检查后的确定性业务成功或拒绝可保存为最终收据。RATE_LIMITED不封存成永久业务结果，到期可以相同ID、相同意图再试。

重复确认保留原业务结果、roomId/handId和应用版本，duplicate改为true；ServerMeta反映本次发送的进程与时间，不回送旧serverEpoch使客户端误以为进程倒退。重启后仍须认证和恢复，不能据旧收据自动重建原房间或续打。

例：room:leave成功移除本人但确认丢失，原commandId重试应返回原退出成功，而不是因为本人已经不在房间改成ROOM_FORBIDDEN；不再发送本人无权查看的实时桌面。其他身份猜到该commandId也不能读取收据，因为actorScope不同。

## 5. 五个服务端事件

| 事件 | 载荷类型 | 范围 |
|---|---|---|
| command:ack | CommandAck | 仅请求控制连接；包含原操作结果，不含底牌 |
| room:view | RoomView | 房间成员可见；不含sessionId、恢复令牌、底牌 |
| game:view | PlayerView | 逐个本人点对点；禁止对房间公共频道广播 |
| game:result | HandResultView | 本手成员允许看到的公开结算；已全押离开者仍可获本人有权结果 |
| session:status | SessionStatus | 对应本人连接，特别是接管后的旧连接；不含令牌 |

room:view与game:view都使用允许字段构建，不从HandState复制后删字段。没有第六个“全部底牌”事件。身份发行/恢复与历史/回放走PrivateResponseMap定义的私有响应。

## 6. 版本与乱序

- expectedVersion仅比handVersion。expectedRoomVersion只比roomVersion；不同用途不互换。
- 重新发送同一个已处理命令先命中收据，不因当前手已推进误拒绝该重试。
- 旧确认只解除对应commandId等待状态，不能覆盖更新的快照；成功确认中的版本是当时应用版本。
- 当前epoch内RoomView按roomVersion比较；PlayerView先比handId，再在同手比handVersion。新手选择由最新room:view的currentHandId确定，旧手迟到事件不覆盖新手。
- room:view和game:view可独立到达；保留各自最新版本。暂时缺少匹配桌面信息时请求同步，不把两份不同时间快照拼成可操作状态。
- 超时任务与电脑结果绑定handId/turnId；真人提交和到时竞争只产生一个有效动作。服务端接收时间用于截止判定，客户端时间不能延长deadline。

## 7. 身份交换与恢复

guest首次私有响应允许发行resumeToken，之后快照/确认/状态/历史/回放均禁止包含令牌。令牌存储摘要，原值不进日志或邀请URL。样例令牌明显标为演示值，不能用于真实身份。

requestId只关联身份交换/查询，不能替代会话内commandId去重。客户端只接受当前等待的身份响应，不让晚到guest结果覆盖有效身份。恢复失败不自动guest重建并占座。

resume必须验证令牌与roomId/lastSeenHandId的本人归属，绑定新connectionGeneration，旧连接立即失权，再返回全量本人快照：

- seatRestored：席位保留，roomView非null；有当前手才有playerView，期限不重置。
- identityOnly：凭据有效但席位过期/房间已关/未入座；两个视图null，可查询本人历史。
- handInterrupted：本人旧手因重启中止，两个视图null；显示重开，不恢复下注。

Socket.IO快速恢复只能辅助，失败仍走该路径。session:status=takenOver后旧连接不能继续发送有效业务命令。

## 8. 回放与样例

history:list与replay:get先按session→participant归属检查，不按“知道房间码”或“曾等待过”授权。弃牌未公开底牌在结束后仍隐藏；ReplayFrame没有实时turnId/deadline/legalActions。

[14组样例](examples/protocol.json)为独立通信夹具，并非连续时间线。每组含id、event、audience、description、request、response、emittedEvents、relatedScenarioIds和context。context仅解释校验前提，绝不作为网络载荷发送。

成功8组：身份发行、创建、加入、开局、加注、恢复席位、身份有效但席位过期、读取回放。失败6组：满员、非房主、过时状态、非法金额、过期身份、回放越权。

## 9. 实施边界

本轮定义纯类型与文档，不建立Socket.IO连接、SQLite表、校验中间件或前端状态管理。W03编译共享声明并建立协议契约测试；W16验证unknown输入；W19实现收据与事务；W20实现过滤；W22实现恢复；W36实现回放权限。

ClientRequestMap、ServerEventMap和PrivateResponseMap是载荷字典，不是Socket.IO函数签名定义。W16传输适配器应将它们包装成具体发送/响应回调；本轮不假定可把载荷类型直接传给某个库的泛型。

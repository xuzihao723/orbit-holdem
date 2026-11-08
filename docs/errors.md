# W02错误契约与客户端恢复

版本：1.0.0｜日期：2026-10-30。ErrorCode与失败载荷见[errors.ts](../packages/protocol/src/errors.ts)，上下文见[protocol.md](protocol.md)。

## 1. 错误表示

业务命令使用CommandFailure，身份/查询使用RequestFailure；两者均ok=false，包含ServerMeta、code、retryable、retryAfterMs、fieldIssues及允许公开的当前ID/版本。仅CommandFailure含duplicate。

message不接受原始异常文本。客户端按code和已校验fieldIssues映射本表中文提示；fieldIssues.reason只允许required、invalidType、outOfRange、invalidFormat、unknownField，field仅引用实际请求字段名。

未认证或未授权房间的失败，roomId、handId、latestRoomVersion、latestHandVersion均为null，不泄露陌生桌信息。有关联ID且验证通过时才回传对应commandId/requestId，否则为null。

## 2. 全部23种错误

| code | 触发条件 | 建议提示 | 原命令重试 | 后续动作 |
|---|---|---|---|---|
| ROOM_NOT_FOUND | 邀请码无对应活跃房间 | 房间不存在或已关闭 | 否 | 保留输入，返回入房 |
| ROOM_FULL | 占座时达到容量 | 房间已满 | 否 | 稍后手动重试用新命令 |
| ROOM_FORBIDDEN | 不是目标roomId的有权成员 | 你不能操作此房间 | 否 | 不附视图，重新入房 |
| INVALID_INPUT | 类型、格式、枚举、长度或未知字段错误 | 请检查输入内容 | 否 | 按fieldIssues定位；修改后新命令 |
| NOT_HOST | 管理或开始请求不是房主 | 只有房主可以执行 | 否 | 更新房主显示 |
| NOT_READY | 准备/在线/重开同意条件未满足 | 还有玩家未准备或离线 | 否 | 本人有权时获取room:view原因 |
| NOT_ENOUGH_PLAYERS | 可参赛座位不足2 | 至少需要两名参与者 | 否 | 等待加入或房主添加电脑 |
| HAND_IN_PROGRESS | 手中修改容量/电脑/重开等 | 请等待本手结束 | 否 | 不自动在下一手重放 |
| NOT_YOUR_TURN | 不是当前actor | 还没有轮到你 | 否 | 获取最新本人game:view |
| ILLEGAL_ACTION | 此时动作不在合法集合 | 当前不能执行此操作 | 否 | 更新操作栏，不替换玩家意图 |
| ILLEGAL_AMOUNT | 金额不是合法安全整数或超合法区间 | 下注金额不合法 | 否 | 重新输入，服务端不自动改额 |
| STALE_STATE | 新请求的对应版本已过时 | 牌桌已更新 | 否 | 丢弃旧意图，获取本人快照 |
| HAND_MISMATCH | 不是本房间当前有效手 | 这手牌已经结束或变化 | 否 | 清除旧手待操作 |
| TURN_EXPIRED | turn已变更或超过截止 | 本次行动时间已结束 | 否 | 同步结果，不恢复旧turn |
| SESSION_EXPIRED | 凭据错误、无效、过期或未认证 | 会话已失效，请重新进入 | 否 | 禁用操作；不自动新建身份占座 |
| SESSION_TAKEN_OVER | 当前连接已被本人新连接接管 | 当前会话已在其他窗口接管 | 否 | 旧连接禁用控制 |
| COMMAND_ID_CONFLICT | 同作用域同ID不同载荷 | 操作编号冲突，请刷新状态 | 否 | 停止原命令，记录客户端异常 |
| RATE_LIMITED | 超过入口/身份/IP限额 | 操作过快，请稍后再试 | 是，到期后 | retryable=true，retryAfterMs为正整数 |
| ROOM_PAUSED | 房间因故障暂停 | 房间已暂停，请等待处理 | 否 | 停止自动提交，显示状态 |
| PERSISTENCE_UNAVAILABLE | 事件/收据提交失败 | 暂时无法保存，请等待恢复 | 否 | 不确认成功，暂停该房间 |
| REPLAY_FORBIDDEN | 不是该手有权参赛身份 | 此身份不能查看该记录 | 否 | 清空旧记录，不发私密片段 |
| REPLAY_NOT_FOUND | 有权范围内找不到记录或尚未完成 | 记录不存在或暂不可回放 | 否 | 回历史列表 |
| SERVER_RESTARTED | 进程epoch变更，原手无法继续 | 服务器已重启，本手已中止 | 否 | 重新认证，查完成历史或重开 |

除RATE_LIMITED外，当前23类失败的retryable均false、retryAfterMs均null。断线丢确认不是一个最终业务拒绝：同一控制身份可用相同ID、相同意图查询/重试，以收据确认是否已应用；turn已失效时不得生成新ID去重放旧下注。

确定性业务拒绝若已封存为收据，同ID重试返回原拒绝；修改意图应使用新ID。限速发生在业务收据之前，不封存为永久拒绝，避免到期重试永远命中RATE_LIMITED。

## 3. W01内部reason映射

| W01或内部语义 | 网络表示 | 说明 |
|---|---|---|
| DUPLICATE_CARD、INVALID_CARD_COUNT | 不作为正常客户端动作错误导出 | 客户端没有传牌入口；若内部触发，暂停房间并发ROOM_PAUSED，细节只入脱敏运维记录 |
| 错误格式、缺失字段、越界容量 | INVALID_INPUT | 字符串金额或非法金额值可细分为ILLEGAL_AMOUNT |
| 当前标线/余额/最低增量不允许该金额 | ILLEGAL_AMOUNT | 不回显内部堆栈和全状态 |
| 无重新加注权、无人可响应仍试图加注 | ILLEGAL_ACTION | allIn不能绕过 |
| 非actor提交 | NOT_YOUR_TURN | 不修改筹码 |
| turn或手已变化 | TURN_EXPIRED/HAND_MISMATCH | 分别校验，不混为金额错误 |
| 保座到期但身份仍有效 | 成功SessionResumed.outcome=identityOnly | 不等于SESSION_EXPIRED |
| 重启后认证有效但本手中止 | 成功SessionResumed.outcome=handInterrupted | 不发成功续打视图 |
| 非本人参赛历史 | REPLAY_FORBIDDEN | 请求已鉴权后仍须逐手授权 |

## 4. 资料验收边界

本文件与类型枚举须逐项同名，样例六类失败须全部可对应。本轮只审查失败契约，不宣称服务端已实施鉴权、限速、事务或错误处理；运行时行为在相应集成任务中验证。

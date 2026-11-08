# 访客身份与连接接管

W15在实际服务入口启用SQLite会话runtime。session:guest和session:resume使用请求专属Socket.IO ack；没有ack不创建身份或接管。仅注册身份事件及disconnect，未增加房间、下注或历史查询事件。

guest严格校验requestId和昵称，昵称trim后1—12个Unicode字素，拒绝控制字符及多余字段。32字节安全随机令牌采用规范43字符base64url；只在本次guest私有ack返回原值。SQLite只存SHA-256摘要，初始connectionGeneration=1，有效期固定createdAt+30天。唯一冲突最多重试3次，I/O失败不重试；持久化成功后才绑定连接。已认证socket再次guest返回INVALID_INPUT。

resume拒绝错误、畸形、非规范及到期令牌，不自动建立替代身份，不回显令牌，也不滑动续期。先验证归属及有效期，再以CAS递增持久代数，最后绑定并通知旧连接takenOver。通知失败不撤销已经提交的接管。服务启动epoch每次改变，代数从数据库继续增长，安全整数溢出不回绕。

checkController每次核对持久有效期、代数及当前socket绑定。旧连接即使在线也失权；迟到disconnect仅能条件释放自己的当前绑定。房间路由及排队后的再次校验由W16/W19接入，目前通过真实连接和服务端守卫验收，不宣称game:action已上线。

恢复默认只给identityOnly/notSeated；已验证归属的退出/关闭记录可给seatExpired/roomClosed。仅数据库已标interrupted且本人参赛的手可返回handInterrupted，不能把任意旧active手伪造中断。seatRestored仅保留类型扩展端口，W17/W20/W22接真实席位、视图和120秒保座。身份30天与保座120秒是两种期限。

index拥有runtime，listen失败和信号关闭清理自己资源；createPokerServer借入runtime只撤销自身监听。开发启动测试传独有DATABASE_PATH。测试及编译后服务均用临时库实际重启认证，凭据只留测试局部内存，报告仅保存脱敏结论。

[W15验收](verification/w15.md) · [数据库](persistence.md) · [本地开发](development.md)

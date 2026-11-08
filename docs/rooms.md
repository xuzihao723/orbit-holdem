# 房间、占座与持久化

W17上线已认证create/join和无当前手的leave。创建2/3/4容量房间时建立初场match，房主seat0获2000，grant、房间、成员、场和收据同事务。房码六位去歧义字符，crypto随机，真实唯一冲突最多10次，I/O不当作碰撞重试。

identity→room两级FIFO防止并发；相同命令同规范意图返回原结果duplicate，新ServerMeta；改意图冲突。同身份不同命令重复join不新入座、不改版本、不多发筹码。未知房码的确定性业务拒绝也存收据，后续房间出现不改变旧请求结果。

容量是占用数上限，不是seatId范围。RoomView始终4槽，开放空槽数量=capacity-occupied，不重排已占座位。playing中加入仅stack0/waitingNextHand，不能进冻结名单或领grant；完整手间发放和手中退出留W23。

应用runtime拥有生产DB，会话/服务借入；关闭先撤网络监听、排空队列，再关自己资源。注入的DB不被应用或会话擅自关闭。房间变更公开后才替换内存/通知；通知失败不再发矛盾失败ack。IO失败在持有房间FIFO时暂停，不在队列释放后覆盖新状态。

控制绑定变更由registry订阅进入房间队列，在线变化以结构化CAS同步roomVersion。在线、房主移交和发布均核对当前代数及会话有效期；旧连接迟到断开不误清新控制。过期绑定不等于有权在线。

持久房间图校验身份/座位、不可变字段和逐参与者台账，阻止零和偷移余额。只给有权当前socket发送显式RoomView，不含sessionId/botId/底牌/令牌。重启不自动恢复活跃房间，W22接中止扫描和保座。

[W17验收](verification/w17.md) · [W16入口](transport.md)


# 服务器重启行为

W23在迁移后、sessions/listen/timer之前，通过一个BEGIN IMMEDIATE事务归档旧epoch：活跃手变interrupted/result保持null、保留最后规则版本；旧房间包含waiting全部closed，活跃场interrupted；参与者只写leftAt/清ready，保留原筹码、事件和ledger。不伪造派奖、cashout、reset或续打。已settled result_json字节不变，已finished场不重写。

归档失败则整批回滚且应用创建失败，不启动监听；重复归档不改已归档结束时间。访客凭据仍有效，携带旧running handId恢复会得到handInterrupted，前端清旧手与动作。本人已完成手的仓储所有权保留；历史公开查询/回放页面在W36—38，本项未宣称已经提供。

这是安全中止机制，不支持重启续手，也不是多实例协调。业务关闭先停到期/回合任务再排空房间队列；借用数据库不由应用关闭。原001/002迁移和协议保持不变。

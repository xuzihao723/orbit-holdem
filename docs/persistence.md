# SQLite持久化基础

W14使用本机Node24.14.1内置node:sqlite（SQLite3.51.2），没有新增npm依赖。该Node版本仍输出ExperimentalWarning，已在实际测试和编译入口中验证。开发数据库与测试临时库严格分开。

DATABASE_PATH默认应用工作目录的.data/orbit.sqlite；拒绝空路径和:memory:配置，不在失败后降级内存。打开时启用foreign_keys、WAL、synchronous=FULL及有限busy timeout，禁用扩展加载。可选readOnly供错误与只读存取验证。关闭幂等，借入runtime的服务器不拥有其数据库。

迁移001创建8张业务表：sessions、rooms、matches、participants、hands、hand_events、command_receipts、chip_ledger。DDL与user_version=1同事务；重复迁移核对真实schema指纹，拒绝未来版本和漂移。STRICT、CHECK、外键、活动房码/席位局部唯一及收据唯一约束共同限制脏数据。

repositories提供结构化会话写读/CAS、事件和收据原子批次、历史归属及台账。commitAppliedCommand同时提交事件、收据与可选一手版本更新；失败回滚，后续同连接仍能成功提交。不暴露异步业务事务回调。同步事务拒绝嵌套和对象/函数thenable，提交阶段外键失败也回滚。

事件和确认按允许字段校验，owner及嵌套座位须属于冻结手名单；JSON递归构造规范副本，不运行输入toJSON、getter或自定义数组迭代器。错误只暴露受控PersistenceError及SQLite数值码。历史归属要求真实手参赛名单，单纯同房不足以读取。

构建在tsc后复制migrations SQL到dist。可从应用根执行：

```powershell
npm.cmd run db:migrate
npm.cmd run build
```

迁移命令使用DATABASE_PATH。测试显式指定独有临时文件并验证清理边界，不读取开发路径。W14的事件/收据事务是基础设施；W19再接房间串行、重试去重和提交后发布，W23接真实筹码台账，W36开放私人历史网络查询。

[W14验收](verification/w14.md) · [会话身份](sessions.md)


## W18增量

当前schema为2；002增加准备、电脑难度和重开提议，001保持原字节。迁移先核验0/1/2原结构，升级后在事务内核验指纹；拒绝漂移不提交半份schema。新增RoomCommit和HandStartCommit结构化图写入，逐座台账和事件核对筹码；新手、收据、场/成员/资金一批提交。dist携带两个SQL资产。[W18开局说明](room-start.md)。

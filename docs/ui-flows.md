# W30真实页面与身份流程

正式路由：/、/play?mode=solo|create|join、/room/:code、/rules、/table/:code。未知/历史入口明确未开放。History API处理内部链接、popstate和返回；生产preview在4173，health/socket代理到3001，服务端测试来源明确4173。日常开发仍5173。

根组件只创建一套client/coordinator/router/intent store，Provider在StrictMode外拥有关闭生命周期；React使用稳定ViewStore snapshot与useSyncExternalStore，解绑订阅和storage监听。没有昵称提交前不创建guest；已有凭据才自动恢复。新guest通过watch开启后续断线恢复，最多六次退避，不自动创建替代访客。

创建/加入成功后显式私有resume取得participantId，候场self由房间ID与私有participantId匹配，不猜昵称、seat0或host。URL只有定位能力。发送、恢复和身份响应均检查凭据是否属于当前身份；共享localStorage身份改变会关闭旧页控制并清私牌，载入新身份需用户明确刷新。

entry-intent.v1只含sessionId、配置、步骤UUID/载荷/状态和已确认房间，不含token/牌。每步先持久化后发送；加电脑按当前版本逐条提交并恢复快照。uncertain保留原UUID/载荷，刷新后用户点继续设置才重试；确定STALE将原步骤保留为superseded，并生成新UUID。完成前核对实际电脑数量/难度、人类数与容量，成员改变不会假装完成。

部分失败保留已建房间和字段，提供继续/回房间；确定未建房失败可修改设置。候场管理确认不确定时可恢复房间状态，不重发新意图；成功变更后的私有resume失败另有重试入口。被接管/过期/断线/未定位self均禁用变更。重建访客身份需用户点击，旧身份无法凭昵称找回。

候场显示全部四逻辑座，包括容量2时占座0/3；人数、状态和准备来自服务端。房主可调容量、加移电脑、提议/取消重开；所有人可准备/取消或同意、离开。邀请码同源且只含room码，Clipboard失败时可手动选择只读链接。开始按钮目前始终解释“对局操作暂未开放”，W31接正式下注之后再开放。

Rules九例由evaluateFive验证，说明最佳五张、花色不分胜负、加注至100且已投20需追加80、边池/退款、30秒check/fold、120秒保座、重启中止。只读桌面只消费本人授权快照，等待者无底牌；期限校准前显示同步提示，校准后立即更新并每250ms刷新，不把静态30当实时期限。

验收使用实际生产Vite包与编译后端、独有SQLite，未使用page.route伪造成功或生产window测试入口。服务组合根的FakeClock只驱动30/120秒边界；确认超时和线程预算仍真实时间。密集测试显式限额connection/session1000、IP10000/秒（identity无session桶），生产默认限额保持。丢确认在真实SQL提交后由测试组合根扣住回复；只读测试的现有手由Node可信控制入口准备，产品没有绕过禁用按钮的测试通道。

后续W31：真实下注/加注/全押确认/结果操作；W32–35：完整素材与设置；W36–38：历史回放。当前不宣称完整对局UI或发布完成。

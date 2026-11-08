# 本地开发与工程验证

当前W01—W15已完成：灰盒前端、完整纯核心单手与规则性质验收、SQLite持久化基础和访客身份/连接接管可用，M0/M1完成。真实房间命令、联机下注、计时/保座、电脑与回放网络服务尚未实现，M2未完成。最终验证为214项core、70项integration及10,000组牌力对照。

## 环境与安装

使用.node-version中的Node24.14.1，npm11，Python3.11及以上用于既有资料校验。在poker-four根目录运行：

```powershell
npm.cmd ci
npx.cmd playwright install chromium
```

macOS/Linux使用npm/npx；Linux首次安装浏览器时可用`npx playwright install --with-deps chromium`。本地无需全局安装TypeScript。

## 启动

```powershell
npm.cmd run dev
```

前端：[http://127.0.0.1:5173](http://127.0.0.1:5173)。服务端健康：[http://127.0.0.1:3001/health/live](http://127.0.0.1:3001/health/live)。页面通过前端/health代理访问服务端，组件不直接访问另一个端口。

按Ctrl+C关闭该开发进程组。启动前检查前后端端口，已被占用则不启动任一服务，不关闭未知进程、不自动切换。服务端监视器等待本进程的启动成功日志；15秒仍未就绪会终止自己的监视子进程，防止“服务器失败但文件监视器仍存活”。首次就绪后的文件变更由tsx watch重载。

.env.example仅记录环境变量名称，不自动加载。默认HOST=127.0.0.1、PORT=3001、WEB_ORIGIN=http://127.0.0.1:5173。需要单独指定服务端配置时，在PowerShell设置环境变量后运行dev:server；前端代理目标固定3001，改服务端端口需同步调整Vite配置。

## 编译与检查

```powershell
npm.cmd run test:fixtures
npm.cmd run typecheck
npm.cmd run test:core
npm.cmd run test:integration
npm.cmd run format:check
npm.cmd run build
npm.cmd run test:e2e
```

typecheck每次从W02 JSON重新生成satisfies夹具，再编译共享包，检查服务端、客户端、测试与工具配置。生成文件不手改、不提交。TypeScript能判断结构，不能证明number是合法筹码或连接有权下注。

test:integration包括真实HTTP、404、Socket连接/断开、关闭/端口冲突、WebSocket来源允许/拒绝、实际统一dev命令的成功/失败/清理，以及协议夹具/生成器检查。集成中的dev检查使用3001/5173，不能与正在运行的开发预览同时执行；先关闭预览再测试，测试不会擅自清理未知监听者。test:e2e目前只验证启动连通、失败与重试，不代表多人完整对局验收。

开发Socket.IO只接受配置的浏览器Origin；未带Origin的原生测试工具可连接。来源检查不等于身份认证；W15已通过私有ack实现访客身份，W16再集中接业务路由与限速。

W05已建立真实core用例，test:core现在必须退出0，并已加入CI。W03/W04历史报告中的退出1表示当时无核心测试，不再是当前预期。电脑与资产命令等有实际实现后再注册。

## 编译后服务端

```powershell
npm.cmd run build
npm.cmd run start
```

start运行apps/server/dist/index.js；健康接口必须可访问。前端dist单独输出在apps/web/dist，正式同域托管由W39完成，当前start不托管前端页面。

## 基线与CI

W01/W02基线不批量格式化，格式忽略列表保护原资料与三个已审协议文件。必要改动先说明原因，重新运行资料校验并更新证据。

.github/workflows/check.yml假定poker-four是未来Git仓库根，配置Windows/Ubuntu检查。本轮未初始化仓库或推送，不能视为GitHub Actions已经通过。若仓库根采用dezhou_app，需将workflow移到实际根，并为步骤设置poker-four工作目录。


## W04灰盒与生产排除检查

开发启动后打开[灰盒牌桌](http://127.0.0.1:5173/?preview=table&scenario=table-four)，底部可展开场景选择；完整场景与边界见[灰盒说明](graybox.md)。固定数据仅用于排版，所有业务按钮禁用，30秒为静态示意。

```powershell
npm.cmd run build
npm.cmd run verify:preview-bundle
npm.cmd run test:production:preview
```

生产预览检查使用4173，开发E2E使用3001/5173，均拒绝复用未知服务。先停止本任务的dev再运行集成/开发E2E。生产检查启动Vite preview，不声称已经部署；生产查询参数不得显示夹具。默认浏览器结果写入w04-playwright.json；可用PLAYWRIGHT_REPORT_FILE指定新报告路径，旧W03历史报告不被覆盖。

W04新增座位、夹具与生产包边界集成检查；完整人数模式牌局验收仍未实现。CI配置增加静态夹具排除与生产预览检查，仍需未来有Git远程后实际触发。


## W05核心组件

[牌组组件说明](core-deck.md)记录严格编号、RandomInt上下界、只读游标、给定庄家的两圈发牌与烧牌接口。单元测试执行冻结C01—C03；安全随机源只在服务端。前端灰盒不接入该私有状态，因此没有新增可玩牌局。

```powershell
npm.cmd run test:core
npm.cmd run test:integration -- tests/integration/random.test.ts
```

core测试直接引用源入口，正式包使用build后的ESM出口。所有core测试及测试辅助器仍参与typecheck。W05未改变web源码，不重复W04浏览器截图；其历史42项开发/3项生产结果保留，不算成本轮新测试。

## W06—W10历史组件与证据

[牌力与独立对照](evaluator-oracle.md)、[位置盲注](core-positions.md)、[下注金额/轮调度](core-betting.md)、[退款/池层](core-pots.md)说明纯函数输入输出和W11/W12的组合边界。最终176项core、38项integration通过；每次完整core还执行固定种子10,000组pokersolver独立对照。

```powershell
$env:ORBIT_VERIFY_STAGE = 'scratch'
npm.cmd run test:core
Remove-Item Env:ORBIT_VERIFY_STAGE
```

未指定阶段同样写scratch-oracle.json。批次验证使用w06至w10保存当时结果；后续工作使用新阶段名，不覆盖这些已验收文件。下注轨迹报告目前只接受w09/w10，其余写scratch。完整回归需先停止本任务dev，否则集成所需3001/5173会冲突。

各阶段真实输出与最终边界见[批次验收](verification/w06-w10.md)。前端没有接私有底牌/下注状态，按钮仍禁用；W10不包含赢家、payout或P05余数。这是W10当时的验收边界；W11—W13现已完成，见下节。


## W11—W15当前能力与验证

W11逐池派奖、W12完整纯单手、W13不变量和失败重放已完成；M1封板。W14有文件SQLite迁移/事件收据事务/历史归属，W15有私有session:guest/resume和连接接管。最终214项core、70项integration、10,000组牌力对照通过。证据见[批次验收](verification/w11-w15.md)及[规则索引](verification/core.md)。

```powershell
npm.cmd run simulate:core -- --output docs/verification/scratch-simulation.json
npm.cmd run db:migrate
```

simulate:core固定读取原I01/I02数量与种子，实际1000手合法及1000次非法；任何失败非0并保存可重放材料。输出路径应为新文件或scratch，不覆盖历史报告。没有可调整生产牌序的网络入口。

DATABASE_PATH默认.data/orbit.sqlite，首次dev/start会创建文件并迁移；也可在启动前设置为指定文件路径。目录及SQLite sidecar已忽略。无自动内存回退；路径、busy或迁移失败受控终止。Node24.14.1内置node:sqlite仍有ExperimentalWarning，本地验证已覆盖此版本。build会复制迁移SQL，start使用实际dist入口和该资产。db:migrate使用同配置，正式部署和备份策略由后续发布阶段完成。

测试显式创建独有临时DATABASE_PATH，集成中的dev仍使用3001/5173，须先停止本任务预览。临时库关闭后仅删除已核对路径的自有目录，开发库不被测试覆盖。已有旧阶段JSON/图片应保留；新验证设置ORBIT_VERIFY_STAGE为新阶段或scratch。W12手轨迹和W13模拟也按阶段写新文件；旧W09下注轨迹继续只保留已接受阶段，其余写scratch。

[结算](core-settlement.md)、[完整手](core-hand.md)、[数据库](persistence.md)、[身份](sessions.md)分别说明实际接口。身份ack只返回本人，不通过URL认证；30天身份与未来120秒保座分离。当前前端仍为灰盒，W16—W24再接房间路由、命令去重、视图、计时、保座和生命周期；M2未完成。history:list/replay:get及电脑能力尚未开放。

## W16—W20当前能力

当前214 core/178 integration、10000牌力对照差异0，房间管理/真实手动真人动作/逐玩家私有快照与客户端网络同步完成，独立真实浏览器1项通过。新命令npm.cmd run test:network:browser先构建，使用独有测试DB和新报告，不覆写W04。端口3001/5173须空闲。

schema2通过002增量保留001原文；准备/电脑难度/重开提议已持久化。电脑仅实体与难度，无策略。web直接依赖socket.io-client4.8.4；模块在src/network，默认同源代理，Vite预优化依赖。正式页面/按钮仍为灰盒，W30/W31接线。计时、保座恢复、完整手间生命周期继续W21—W23，M2未完成；不承诺已能通过产品UI联机。详见[批次验收](verification/w16-w20.md)、[房间](rooms.md)、[开局](room-start.md)、[动作](command-processing.md)、[个人投影](player-views.md)、[客户端](network-client.md)。

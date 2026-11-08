# ♠ 轨道牌桌 · Orbit Hold’em

**用虚拟筹码练习德州扑克，或邀请朋友一起开一手。**

支持 2–4 人同桌。你可以独自挑战电脑，也可以开一张真人和电脑混坐的牌桌。每手结束后，可以从自己的历史记录回看下注和结算过程。

[快速开始](#快速开始) · [怎么玩](#怎么玩) · [部署到-render](#部署到-render) · [项目结构](#项目结构) · [开发与验证](#开发与验证)

![轨道牌桌的三人对局。公共牌、本人底牌、对手席位和行动区都在同一桌面。](docs/showcase/orbit-table-desktop.png)

[查看新版首页](docs/showcase/orbit-home.png) · [查看手机四人局](docs/showcase/orbit-table-mobile.png)

## 游戏特色

- **三种入场方式。** 单人练习、创建房间、凭房间码或邀请链接加入。电脑有入门和标准两档。
- **完整的德州流程。** 支持盲注、加注、全押、边池、平分底池和未匹配筹码返还。下注区分别显示本轮总额和本次需要再投入的筹码。
- **联机恢复与个人回放。** 断线后可凭原身份恢复保留的席位。牌局回放只显示当时公开的信息和本人的底牌。
- **适配桌面和手机。** 可切换标准双色或四花色牌面、牌背、音效和减少动画。音效默认关闭。

## 快速开始

需要 Node.js **24.14.1**、npm **11**。Python 3 用于素材与夹具验证。版本以 [`.node-version`](.node-version) 和 [`package.json`](package.json) 为准。

```sh
npm ci
npm run dev
```

打开 [本地首页](http://127.0.0.1:5173/)。开发命令同时启动前端和联机服务。[服务就绪检查](http://127.0.0.1:3001/health/ready) 返回 `{"status":"ready"}` 后即可进房。

访客可直接开始。启用 Google 登录或邮箱账号的步骤见[账号配置](docs/account-auth.md)，可用变量见 [`.env.example`](.env.example)。

## 怎么玩

1. 从首页选择 **单人练习**，配置电脑人数和难度。和朋友玩时，选择 **创建房间**，把房间码或邀请链接发给朋友。
2. 真人入座后点击 **准备**，由房主点击 **开始本手**。本机测试多人联机时，用无痕窗口或独立浏览器会话加入，分别保留不同的访客身份。
3. 结算后可准备下一手，或在 **历史记录** 中打开自己的牌局回放。

## 部署到 Render

[`render.yaml`](render.yaml) 提供免费试玩配置。它在新加坡创建一个 Docker Web Service，通过同一个地址提供网页、HTTP 接口和 Socket.IO。将仓库连到 Render，在 **New → Blueprint** 选择该仓库，部署完成后访问 Render 提供的 `onrender.com` 地址。

免费实例空闲约 15 分钟会休眠，首次唤醒可能需要约 1 分钟。免费实例的 SQLite 数据会在休眠、重启或重新部署时丢失。[Render 免费版限制](https://render.com/docs/free)

长期运行可用带持久卷的单实例 Docker Compose 部署。已结算历史保存在持久卷中，重启时进行中的牌局会标记为中止。[常驻部署](docs/deployment.md) · [备份与恢复](docs/backup-restore.md)

## 项目结构

项目使用 npm workspaces。前端用 React、TypeScript 和 Vite，联机用 Node.js、Socket.IO 和 SQLite。

| 目录                                         | 职责                                   |
| -------------------------------------------- | -------------------------------------- |
| [`apps/web`](apps/web)                       | 大厅、牌桌、账号、设置和历史回放       |
| [`apps/server`](apps/server)                 | 房间、身份、联机同步、电脑调度和持久化 |
| [`packages/poker-core`](packages/poker-core) | 洗牌、牌型比较、下注状态和分池结算     |
| [`packages/protocol`](packages/protocol)     | 客户端与服务端共用的消息和视图类型     |
| [`assets`](assets)                           | 卡面、筹码、头像和音效                 |

[技术报告](docs/technical-report.md) · [产品规则](docs/product-rules.md) · [协议说明](docs/protocol.md)

## 开发与验证

```sh
npm run test:core
npm run test:integration
npm run build
npx playwright install chromium
npm run test:e2e
npm run verify:release-artifacts
```

浏览器测试使用独立访客和临时数据库。运行测试前，释放相应的本地端口。可用 `npm run simulate:bots -- --hands 200` 跑电脑对局模拟。[开发指南](docs/development.md) · [验收记录](docs/verification/w31-w40.md)

## 素材与致谢

项目内原创几何 SVG 与合成音频的许可见[素材账本](assets/LICENSES.md)。README 的结构和展示方式参考 [Awesome README](https://github.com/matiassingers/awesome-readme) 和 [Best-README-Template](https://github.com/othneildrew/Best-README-Template)。

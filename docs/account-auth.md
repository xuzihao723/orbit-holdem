# Google 登录与游客

在登录页选择「使用 Google 登录」，然后在 Google 页面选择已有账号。首次授权自动创建轨道牌桌账号，再次登录按同一个 Google 身份恢复牌局权限。通过邀请链接登录后会回到原邀请页。首页也可选择「以游客继续」。Google 登录使用基础账号资料和邮箱作为显示信息，稳定身份取自 Google 的主体标识。

## 本地 Google 登录

在 Google Cloud 创建 **Web application** OAuth 客户端。把 `http://127.0.0.1:5173/api/auth/google/callback` 添加为授权重定向 URI。希望外部玩家使用各自的 Google 账号时，将受众设为 **External**。本项目只请求基础身份权限，适用 Google 测试模式的例外，无需逐个添加测试账号。[Google OAuth 配置](https://developers.google.com/identity/openid-connect/openid-connect#appsetup) · [Google 受众设置](https://support.google.com/cloud/answer/15549945?hl=en)

在项目根目录保存私有 `.env`，填入客户端 ID 和密钥。`.env` 被 Git 忽略。关闭占用 5173 的预览进程后，从项目根目录启动编译服务。

```dotenv
GOOGLE_CLIENT_ID=填入你的客户端ID
GOOGLE_CLIENT_SECRET=填入你的客户端密钥
HOST=127.0.0.1
PORT=5173
WEB_ORIGIN=http://127.0.0.1:5173
WEB_DIST=apps/web/dist
DATABASE_PATH=.data/orbit-auth-preview.sqlite
```

```powershell
npm.cmd run build
node --env-file=.env apps/server/dist/index.js
```

打开 [本地登录页](http://127.0.0.1:5173/login)。正式环境在 Google Cloud 登记同一回调路径的 HTTPS 地址，并在 `deploy/runtime.env` 私下配置两项 Google 凭据和 `AUTH_PROXY_KEY`。Google 登录独立于邮件投递配置。v4 迁移保留原有账号、登录和牌局，Google 身份与旧邮箱账号各自对应自己的牌局记录。

## 旧邮箱账号兼容模式

仅启用旧邮件配置时，显示既有邮箱和牌桌密码入口。两个渠道均启用时，默认显示 Google 登录，原用户可通过「旧邮箱账号登录」访问原账号。

首页「登录 / 注册」支持邮箱收码、设置密码、密码登录和找回密码。Gmail、Outlook 等地址可用作收件邮箱。邀请链接可先登录，再回到原入房入口。游客可以直接开桌和加入。

已持有有效游客凭据的玩家可以在注册时选择保留当前游客记录。进行中的手结束后才允许升级。升级沿用原牌桌身份，结算、筹码归属和历史权限随该身份保留。登录已有账号时读取该账号自己的记录。

### 本地试用

在 PowerShell 进入项目目录并执行以下命令。数据库独立于原有游客预览库。验证码由本地服务在终端显示，服务仅允许在回环地址启用该模式。

```powershell
$env:AUTH_EMAIL_MODE = 'local'
$env:DATABASE_PATH = '.data/orbit-auth-preview.sqlite'
npm.cmd run dev
```

打开 [本地首页](http://127.0.0.1:5173/)。发码后在终端查找 `[local-email]` 行。可以输入测试邮箱。已编译的浏览器验收使用独立内存数据库和内存投递器，运行 `npm run build` 后执行 `npm run test:auth:browser`。

### HTTPS 环境

默认关闭邮箱账号。目标环境使用 `AUTH_EMAIL_MODE=resend`、`AUTH_EMAIL_FROM`、`AUTH_CODE_KEY`、`AUTH_PROXY_KEY` 和 `RESEND_API_KEY`。两个本地密钥分别使用独立的 32 字节随机十六进制文本。发信密钥只在服务器配置，通过经验证的发件域发送。真实邮箱验收需要已有获授权的主机和发件域。[Resend 发信接口](https://resend.com/docs/api-reference/emails/send-email) · [发件域设置](https://resend.com/docs/dashboard/domains/introduction)

验证码初始有效期 5 分钟，同一邮箱和用途的重发间隔为 60 秒，每次挑战最多尝试 5 次。默认每日最多接受 95 次发码请求。Compose 将 `AUTH_PROXY_KEY` 传给应用和 Caddy。Caddy 覆盖上游的客户端 IP 和代理密钥请求头，应用仅采信经密钥验证的单个地址。实际收件率、拒收、代理和额度由目标环境验证。

密码使用带随机盐的异步 scrypt。账号登录采用 HttpOnly Cookie。HTTP 登录后重新建立 Socket.IO 连接，由服务端核验账号会话，再接管原牌桌身份。密码重置撤销账号的旧登录，退出只撤销当前登录。

迁移前备份 SQLite。应用恢复备份时保留账号和牌局数据，并在发布恢复文件前清除快照中的旧登录、验证码和 Google 授权状态。回退需使用迁移前备份。[备份与恢复](backup-restore.md)

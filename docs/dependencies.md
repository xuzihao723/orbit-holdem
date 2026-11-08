# W03运行时与依赖记录

核验日期：2026-10-30。运行环境Node.js 24.14.1、npm 11.11.0、Python 3.11。本轮未安装任何全局项目工具或修改Windows执行策略。

采用Node 24系列现有补丁作为可复现起点，.node-version记录24.14.1，engines限制24.14.1及以上的24系列；这不是“最新补丁”的声明。[Node发布状态](https://nodejs.org/en/about/previous-releases)

依赖版本来自实际npm注册表元数据中的version、engines、peerDependencies，均使用精确版本写入清单和根package-lock.json。没有使用浮动latest或自动改变本机Node/npm。

| 位置 | 包 | 版本 | 用途 |
|---|---|---|---|
| 根开发 | typescript | 6.0.3 | 选择6系列稳定版本编译现有声明，不自动升级到注册表7系列 |
| 根开发 | @types/node | 24.19.2 | 与运行时24系列对应 |
| 根开发 | vitest | 5.0.5 | 集成/规则项目分离 |
| 根开发 | @playwright/test | 1.64.1 | Chromium浏览器烟测 |
| 根开发 | tsx | 4.23.15 | 服务端开发运行/监视 |
| 根开发 | concurrently | 10.0.6 | 管理前后端开发进程 |
| 根开发 | prettier | 3.9.10 | 新增代码与配置格式 |
| 根开发 | socket.io-client | 4.8.4 | 真实传输连接测试，尚不接游戏事件 |
| 根开发（W06新增） | pokersolver | 2.1.4 | 仅测试的独立牌力对照，MIT；不进入应用运行依赖 |
| server | socket.io | 4.8.4 | 与HTTP共用服务端 |
| web | react / react-dom | 19.3.1 / 19.3.1 | 最小连接状态页面 |
| web开发 | @types/react / @types/react-dom | 19.3.0 / 19.3.0 | React声明 |
| web开发 | vite | 8.3.5 | 开发、代理与前端构建 |
| web开发 | @vitejs/plugin-react | 6.1.2 | React集成 |

Vitest5要求受支持Node22.12+/24+/26+组合，Vite8与React插件的实际peer版本范围已核对。本机Node24.14.1符合所选依赖引擎范围。首次npm install完成时报告0个已知漏洞；这仅记录当时审计结果。[Vitest安装要求](https://vitest.dev/guide/)、[Vite说明](https://vite.dev/guide/)

四个工作区版本统一0.1.0；@orbit/server引用本地protocol/core，@orbit/web只引用protocol。npm ls --workspaces --depth=0确认四包均为本地链接，没有误从远端下载同名业务包。

浏览器由Playwright安装到用户的标准缓存位置，版本由@playwright/test锁定；不把浏览器二进制加入源目录。GitHub Actions依赖本次官方release查询结果：checkout v7.0.1、setup-node v7.1.0、setup-python v7.1.0；当前仅保存配置，尚未触发远程执行。

核验来源包括npm官方注册表各包元数据，例如[TypeScript](https://registry.npmjs.org/typescript/6.0.3)、[Vite](https://registry.npmjs.org/vite/8.3.5)、[Vitest](https://registry.npmjs.org/vitest/5.0.5)。后续更新必须重跑类型、集成、浏览器和构建检查。

W06使用精确开发依赖pokersolver@2.1.4并更新根锁文件，安装当时npm报告0漏洞。版本、完整性、导入方式、固定种子与对照范围见[牌力对照说明](evaluator-oracle.md)；不升级其余应用依赖。


## W11—W15运行时补充

2026-10-31：本批没有新增npm包或改动锁文件。SQLite采用本机Node24.14.1内置node:sqlite，实际SQLite版本3.51.2；STRICT、WAL、外键、同步事务、文件重开及编译SQL资产均经真实测试。此Node版本会显示ExperimentalWarning，不能把本机验证写成跨版本兼容承诺。身份随机令牌和摘要使用node:crypto，昵称字素使用Intl.Segmenter。详见[持久化说明](persistence.md)及[批次验收](verification/w11-w15.md)。

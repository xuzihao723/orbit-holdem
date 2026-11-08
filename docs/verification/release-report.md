# W41—W44 本地发布候选验收

2026-11-06。轨道牌桌 0.1.0 本地候选通过本轮复验。[本地预览](http://127.0.0.1:5173/) · [验收清单](release-checklist.md) · [候选指纹](w44-manifest.json)

| 任务 | 当前结果 | 证据 |
|---|---|---|
| W41 实机试玩 | 脚本、反馈单、场次表和问题模板已准备。正式跨网待目标环境，真实反馈为 0 份。 | [试玩准备](w41.md) |
| W42 作品 | 干净目录验证了安装、开发启动、构建和发布入口。已交付 README、技术报告、五类截图与两分钟本地录屏。 | [README](../../README.md) · [作品索引](../showcase/index.md) · [录屏指纹](w42-capture.json) |
| W43 实验 | 完整采集 180 条。快照组 90/90 恢复并继续，90 次重复探针无额外扣款。基线组在固定无新消息窗口内保留旧版本。 | [实验结果](../experiments/reconnect/summary.md) · [原始 CSV](../experiments/reconnect/raw.csv) |
| W44 本地验收 | 在独立目录使用锁文件安装。格式、类型、夹具、构建、素材及发布扫描通过。编译服务在独立库上通过 HTTP 和 Socket.IO 检查。 | [本地命令](w44-commands.json) · [开发专项](w44-dev-commands.json) · [编译部署](w44-local-deploy.json) |

## 复验结果

- 规则 214 项、集成 416 项。10,000 组独立牌型对照无差异，200 手电脑模拟无非法动作、筹码不守恒或卡局。[规则](w44-core.json) · [集成](w44-integration.json) · [模拟](w44-bot-sim.json)
- 浏览器共 98 项通过，其中主发布矩阵 33 项。五种视口各覆盖 2、3、4 人桌，2、3 人桌验证等候席不可见底牌且无行动权限，满四席验证拒绝额外加入。[发布矩阵](w44-release-playwright.json) · [组件状态板](w35-state.md)
- W35 补开发态状态板并修复 React 开发重复挂载造成的播放失效。重新运行设置、回放与生产预览，并扫描开发态入口。W34 十个音频文件解码通过。[音频](w44-audio.json) · [产物扫描](w44-release-artifacts.json)
- 旧重连与生命周期测试使用同源的独立模块探针，确认现有 WebSocket 已关闭后再恢复。初次夹具复验补齐来源文件后通过。运行记录保留早期失败，最终通过项见各自命令与 JSON。[探针复验](w44-probe-verification.json) · [重连](w44-reconnect.config.json) · [生命周期](w44-lifecycle.config.json)
- 实验所用运行时代码及本地候选的 JavaScript、迁移和前端产物逐字节核对。保留既有 191 项验收材料和 8 项冻结输入指纹。[候选指纹](w44-manifest.json) · [编译清单](w44-build-hashes.json)

## 待最终签收

W34 人工试听，W39/W40 目标容器、持久卷、HTTPS 与公网冒烟，W41 五人跨网试玩和实机问题关闭，以及试玩后的正式录屏确认。V3 / M5 最终封板待这些项完成。[试听单](audio-listening.md) · [已知限制](known-limitations.md)

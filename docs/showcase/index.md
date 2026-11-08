# 本地演示与截图

| 素材 | 场景 |
|---|---|
| [两分钟演示视频](demo.mp4) | 1280×880，00:02:00，七段实际界面录屏与中文字幕 |
| [首页](home.png) | 1280×800，生产构建与产品入口 |
| [桌面牌桌](table.png) | 1280×800，两个独立访客开局 |
| [360px 手机](mobile-360.png) | 360×640 视口，公共牌、本人底牌和下注操作 |
| [边池结算](sidepots.png) | LIFE04 隔离夹具，主池 300、边池 300、退款 150 |
| [历史回放](replay.png) | 已授权记录逐步回放至末帧 |

录屏使用 2026-11-06 本地候选、编译服务、独立测试身份和临时库。字幕按[镜头脚本](../demo-script.md)制作。为便于阅读，画面减速并停留在各段关键结果。视频为无旁白的本地展示版。房间码和底牌来自隔离示例。

复拍时在 `poker-four` 中先构建，再运行 `npx playwright test --config playwright.showcase.config.ts`。录像与四类截图写入 `test-results/w42-showcase`。边池截图由 `npx playwright test --config playwright.table.config.ts --grep LIFE04` 生成。最终正式展示使用目标验收后确认的候选。

# 独立电脑模拟

运行 `npm.cmd run simulate:bots -- --seed 20261031 --hands 200 --output docs/verification/新的报告.json`。先完整build，再加载生产dist规则/命令/SQLite/调度和真实编译worker。CLI只接受seed安全整数、hands=1–200和验证目录内不存在的json；写入wx，不覆盖旧报告。

四个固定bot身份，不伪造guest、不监听端口。纯开手候选与产品授权分离，正式入口仍检查真人房主/在线/准备；脚本仅替代手间确认及bot-only房间的关闭边界。每动作经可信命令事务和内核不变量，每手核验SQL余额、一次结算、连续事件、归零贡献及录制动作重放。

1–50 basic，51–100 standard，101–200轮换两basic两standard。牌序、庄家、每bot策略/延迟/采样由不同域派生。业务时间快速推进，计算仍按真实150ms；机器调度影响样本和决策，复现使用报告内完整deck与实际动作trace，经replaySimulationHand直接重放，不声称跨机器重新求解必然逐动作相同。

每手最多200推进、全程300秒保护。首失败停止保存最短前缀；正式200手还必须至少一次standard采纳。只有手间少于2人有筹码才新match并remove/grant，重置不计盈利。报告含三组指标、每job绑定/seed/实际返回样本、无结果的未知样本计数、环境、指纹及资源清理。

验证目录是独立测试材料，含测试牌序，不通过公网或生产日志发布。原始第一轮错误随机适配导致固定deck，保留w28-initial-rejected.json明确拒收；最终报告是w28-bot-sim.json，详见[w28验收](verification/w28.md)。

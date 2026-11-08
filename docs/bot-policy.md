# 电脑策略与调度

W25（2026-11-01）实现basic纯启发式：Observation+独立PolicyRandom输入，不能读取RoomState或真实隐藏牌。翻前分数clamp(2*(高牌-2)+对子35+同花6+差距≤1加6/差距≥4减4,0,100)，是项目自定粗分，不是胜率。后位门槛降低4，四人桌增加4；中等45/强60，翻后真实evaluateBest类别≥1/≥2。

实际成本=min(callAmount,stack)，成本比cost/(potTotal+cost)，弱/中/强上限0.08/0.25/0.50。免费可check时强牌以0.35概率最小合法bet/raise；可承受成本时强牌以0.25概率最小raise，否则call或合法短allIn-call。无重开权不raise，所有意图再次适配；异常/非法/无动作回退check、fold、null，不自动call。

展示延迟500+floor(delayRng*1001)ms，与策略及真实洗牌随机抽样分开。每room/hand/turn/bot只保留一个任务，已入队也保留当前task资格；提交队内再核对isCurrent与关闭状态，取消的迟到结果无效。延迟不持房间槽；期限不足改即时安全动作，截止仍用原deadline，和timeout仅一项能推进。时钟/投影同步异常转取消和pause，不逃出定时器。

仅成功SQL/store后的hook安排任务，paused/closed/settled/移除/关闭取消。diagnostics的scheduled/applied/stale记录调度结果，cancelled计任务槽清除（包含成功推进后旧槽的释放），safeFallbacks计被要求即时安全动作；不把这些计数解释为策略优劣。产品仍需真人每手准备，不自动开下一手或纯电脑续局。

W25的standard阶段性使用basic回退；W26建立纯采样内核，W27已接入真实线程池：翻前牌表策略、翻后预算内估计，异常/无样本回退basic，详见[运行时](bot-runtime.md)。测试配置仅后端依赖注入，不是公网控制开关。

验证范围含原ROOM01—09及12个难度配置，七组合、单人第二手、暂停/关闭/超时/跨房间/失败提交与真实全离线生命周期；不宣称GTO或已证明更强。

# W01场景资料格式

`scenarios.json`是JSON数组。每项含id、category、description、given、when、expected，并带source和scope追溯来源与测试层级。资料本身不执行牌局；后续W05—W23的测试适配器按operation读入。

## 编号

- 核心41项：C01—C03、E01—E07、O01—O05、B01—B12、S01—S05、P01—P07、I01—I02。
- 模式13项：ROOM01—ROOM13，覆盖单人1/2/3电脑、纯真人、混合桌及开局边界。
- 生命周期12项：LIFE01—LIFE12。
- 隐私4项：PRIV01—PRIV04。
- 补充牌型4项：RANK01—RANK04，补足高牌、三条、同花、四条的固定期望，不改动既有41个编号。

合计74项。E01—E07加RANK01—RANK04覆盖九种牌型与比较边界。

## 字段和约定

- `given`：初始状态或测试驱动器的参数；组件测试不强求构造完整房间。
- `when.operation`：未来适配器分派的操作名；不是现有代码函数的实现承诺。
- `when.actions`：按给定顺序执行的行动；seatId和actor必须可追溯。
- `expected`：明确事实或不变量；不包含“已通过”的运行状态。
- `source`：原规划对应章节/编号，便于变更回溯。
- `scope`：component / hand / property / room / lifecycle / privacy。
- `source`：含document、section、scenarioId的来源对象；document路径相对本目录。
- `stack`在给定行动状态中均指扣完已投入后的剩余；`initialStacks`明确指本手扣盲注前余额。
- 逻辑座位0—3顺时针递增。cardId使用S/H/C/D，2—A，10用10，不能用T。
- `deck`按从左到右消耗，未洗牌规范顺序用`deckOrder`声明；固定牌序仅供测试。
- `expected.legalActions`使用fold/check/call/bet/raise/allIn。toCall大于等于stack时使用allIn，不同时要求call。
- `handRank`比较向量第一个数字为0—8牌型类别，后续为主牌/踢脚。分池组件可直接输入预先给定的向量；不把它当成可达完整牌局的证明。
- `null`表示“不允许/不适用”的范围，不使用-1冒充合法金额。
- 核心组件的DUPLICATE_CARD等reason是规则语义断言；W02再定义其网络错误映射，不直接假定它们均是Socket.IO错误码。
- 属性测试给出seed、样本数量、保护上限与失败准则；不预先编造最终牌局结果。

## JSON无法直接存储的JavaScript值

NaN、Infinity、undefined不能写成裸JSON。使用测试专用标签：

```json
{ "$jsNumber": "NaN" }
```

同类值为`Infinity`、`-Infinity`；`{"$jsValue":"undefined"}`用于缺失输入测试。字符串金额直接写`"40"`，与真实数字40区分。未来测试适配器只在测试环境解码，生产协议不能接受这些标签。

## 验证边界

W01校验JSON语法、唯一编号、必需字段、牌编号、具体牌组唯一性、金额分层、样例发牌及跨文档对应关系。它不证明未来引擎能够通过这些场景，也不替代随机模拟、网络集成或真实试玩。

W01验证证据见[../../docs/verification/w01.md](../../docs/verification/w01.md)。

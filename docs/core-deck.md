# 牌编号、洗牌与发牌组件（W05）

当前poker-core提供牌组及确定性发牌基础，不是完整单手规则引擎。它不处理盲注轮转、筹码、合法行动、判型或结算，也不注册房间事件。调用方给定已确定的庄家和参赛者；何时允许发公共牌由后续单手状态机决定。

## 牌编号与类型

标准编号为`${Rank}${Suit}`，Rank为2—10/J/Q/K/A，Suit为S/H/C/D。规范牌组为每花色2—A，依S/H/C/D排列。只接受严格大小写；不将T转成10，不trim空白。parseCard返回id/rank/suit/value，A=14；A低顺判断留W06。

核心自身声明CardId/SeatId，并通过tests/contracts/card-types.ts与protocol双向编译赋值检查兼容。核心不依赖protocol、Node、DOM、网络或全局随机源。

## 公共函数出口

通过`@orbit/poker-core`导入编译包；core内部相对导出使用.js。单元测试直接引用源入口，避免旧dist遮蔽修改。

| 函数 | 输入与结果 |
|---|---|
| createDeck() | 返回独立的52牌可变数组；不会暴露内部编号集合 |
| isCardId(unknown) | 严格类型守卫，非法值返回false |
| parseCard(unknown) | 返回冻结的解析结果，非法值抛TypeError |
| createDeckState(cards) | 仅接受52合法唯一牌，复制并冻结，cursor=0 |
| draw(deck,count) | 从牌首游标取0及以上整数张，返回冻结取牌结果和新游标 |
| shuffleDeck(cards,randomInt) | 复制52牌，从51至1执行51次Fisher–Yates，校验每次索引 |
| getDealOrder(seatIds,dealer) | 给定庄家之后的下一占座顺时针至庄家；不改逻辑ID |
| dealHoleCards(deck,seatIds,dealer) | 逐人draw1张、共两圈，底牌存为seatId对应的只读二元组 |
| dealNextStreet(hand,street) | 验证0/3/4张公共牌及对应烧牌数量，再烧1发3/1/1 |

输入牌序和旧状态保持不变；成功返回新对象，失败不消耗旧游标。工厂创建的牌数组、快照、底牌二元组、公共牌和烧牌均冻结。DeckState是内部类型；不把外部JSON强制转换为它，W05不承担任意伪造完整手状态的网络校验。

## 随机源与生产调用

RandomInt签名为`(minInclusive,maxExclusive)=>number`。shuffleDeck明确要求调用方传入；没有Math.random兜底、没有客户端seed参数。

服务端唯一适配位于`apps/server/src/game/random.ts`，转调Node内置crypto.randomInt。核心及浏览器不导入该适配。调用示例仅供未来服务端编排，不新增网络开局能力：

```ts
import {createDeck,shuffleDeck,createDeckState,dealHoleCards} from '@orbit/poker-core';
import {secureRandomInt} from './random.js';
const deck=createDeckState(shuffleDeck(createDeck(),secureRandomInt));
const hand=dealHoleCards(deck,[0,1,2,3],0);
void hand;
```

恒等排列是合法随机输出；测试不要求多次输出不同。测试桩下界0的全序与原C03逐项相等，安全适配测试只断言合法边界、单值区间和集合保留，不用少量样本声称统计公平。

## 发牌及阶段

底牌按每圈下一占座→…→庄家发。双人此下一座是大盲，所以大盲先收、庄家后收；三至四人起点是小盲。支持不连续座位，例如[3,1]庄家3时每圈1→3；[0,2,3]庄家2时每圈3→0→2。

| 阶段 | 本步消费 | 本步之后公共牌/烧牌 |
|---|---|---|
| 两圈底牌 | 2×人数 | 0 / 0 |
| flop | 烧1发3 | 3 / 1 |
| turn | 烧1发1 | 4 / 2 |
| river | 烧1发1 | 5 / 3 |

2/3/4人完整至河牌消耗12/14/16，剩余40/38/36。跳街、重复街、烧牌数量不符、剩余不足会失败，不返回半个翻牌。完整底牌/烧牌/公共牌/未发段分割原52牌，没有重复。

## 错误与私有边界

内部标记为INVALID_CARD、INVALID_DECK_SIZE、DUPLICATE_CARD、INVALID_RANDOM_INDEX、INVALID_CURSOR、INVALID_DRAW_COUNT、DECK_EXHAUSTED、INVALID_SEATS、INVALID_DEALER、INVALID_STREET_SEQUENCE。安全随机源的参数异常按Node原错误传播。这些不是新增的网络错误码，不直接向客户端发送异常对象。

DeckState.cards含整副牌；DealtHand.holeCards含所有参赛者底牌，burnCards含烧牌。这些仅在核心/服务端内部使用，绝不能展开到RoomView/PlayerView或广播。当前未接真实房间处理器，W05的源码边界审计不等于W16未知字段拒绝或W20权限投影测试已经完成。

## 用例与交接

C01—C03仍读取W01冻结scenarios.json，由tests/helpers/card-scenarios.ts验证必要形状后适配；不复制第二份期望资料。C02从真实游标按阶段执行，再比较原dealOrder/holeCards/board/burnCards/consumed；C03比较原完整期望排列。

core首次有真实用例，`npm run test:core`现在必须退出0，CI已加入该命令。历史W03/W04的“空集合退出1”仅表示当时状态。实际结果见[W05验收](verification/w05.md)。下一任务W06牌型比较，W07再实现庄家/盲注与行动位置轮转。

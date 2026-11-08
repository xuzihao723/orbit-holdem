# W06 牌力评估与独立对照

`evaluateFive(cards)` 接收恰好5张，`evaluateBest(cards)` 接收5—7张严格 CardId，拒绝重复和非法牌。九类牌型由高牌0至同花顺8；`compareHandRanks(a,b)` 返回正数表示a强、0表示平手。A2345的最高张为5，花色不参与输赢。

最佳五张通过枚举所有5张组合产生，7张最多21组。等强组合按W05牌组顺序选稳定代表；这只是输出稳定性，不是花色胜负规则。结果、比较向量和最佳五张均冻结。比较器验证向量长度、数值与对应牌型的结构，包含稀疏数组保护。

独立对照仅在测试中使用根开发依赖 `pokersolver@2.1.4`，MIT许可。来源为[作者仓库](https://github.com/goldfire/pokersolver)和[精确npm元数据](https://registry.npmjs.org/pokersolver/2.1.4)。锁文件完整性：

```text
sha512-vmgZS+K8H8r1RePQykFM5YyvlKo1v3xVec8FMBjg9N6mR2Tj/n/X415w+lG67FWbrk71D/CADmKFinDgaQlAsw==
```

实际包版本取package.json的2.1.4；其源文件头仍标2.1.2，不以注释头覆盖包版本。适配器使用真实CommonJS默认导入中的Hand.solve/Hand.winners，将10转为T、花色转小写；不假定双方rank数值相同。

先校准九牌型和胜负方向，再以测试专用xorshift32固定种子 `0x06002026` 生成10,000组无重复7张牌。每组核对牌型、最佳五张与原7张的独立强度等价，并比较相邻样本的胜负方向。测试层的模映射只用于可重复样本；正式洗牌仍依赖W05注入随机源及服务端安全随机数。

每次完整core回归都会执行对照。设置 `ORBIT_VERIFY_STAGE=w06` 至 `w10` 分别写对应oracle报告；未指定只写scratch，避免后续阶段覆盖W06证据。样本不是所有牌组合的穷举证明。实际结果及负向破坏见[W06验证](verification/w06.md)。

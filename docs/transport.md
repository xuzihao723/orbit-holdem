# 传输入口与限速

W16提供严格plain对象解码、11种变更与2种查询载荷校验、可信控制上下文、统一错误和三层滑动窗口。查询只解析并私有拒绝，W36再开放；房间executor由W17后接入，W16本身没有真实房间成功结果。

game:action连接/身份各10次/秒、IP60；create/join共享连接/身份各5次/分钟、IP30；其他房间变更20/秒、IP120；guest/resume连接10/分钟、IP60；全部应用尝试连接50/秒、IP200。身份/IP桶不因重连清空。配置可注入，W41校正初值。IP仅取socket远端，不信自报转发头。

滑动窗口为(now-window,now]。同次分类检查全通过才消费，失败等待取最大约束；桶容量按足够整个桶最后一次请求到期计算，不返回Infinity。最多10000活跃桶，先清过期，再拒绝新key而不淘汰活跃身份。测试注入时钟，不实际等一分钟。

昵称复用W15字素校验，房码trim并规范ASCII大小写；版本安全整数，动作只接正式字段，坏金额ILLEGAL_AMOUNT，额外字段INVALID_INPUT。control/receivedAt由服务端构造。identity/query用请求专属ack，变更用本人command:ack；包括坏参数、限速和未知事件均不广播异常或原载荷。

16KiB为Socket.IO/Engine.IO整包限制；超大包断开传输，不能要求应用ack。注册器关闭删除自身连接/socket监听，并释放自己的控制上下文，不关借入DB。无ack身份事件无副作用但仍计入限速。

[W16验收](verification/w16.md) · [后续实施总览](../../plan/27-W16至W20实施总览.md)


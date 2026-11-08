# 前端网络模块

W20在apps/web/src/network提供createSocketClient，接受同源默认地址或显式url、credentialStore、ViewStore和timeoutMs，提供connect/guest/resume/sendCommand/disconnect/close。web直接依赖精确socket.io-client@4.8.4，Vite已有WebSocket代理，并预优化该依赖以避免初次动态导入重载。正式产品页面/按钮仍由W30/W31接线。

凭据适配默认localStorage（无浏览器则内存），只保存私有guest响应的sessionId/resumeToken/expiresAt；resume不回显令牌时保留原值。令牌不放URL、日志或视图。过期不自动新建身份，takenOver不自动resume抢权、不删除共享凭据。只有当前连接与当前requestId的私有身份响应能建立epoch；旧连接/请求响应不能切回。

ViewStore运行时按封闭字段校验嵌套数组、枚举、安全数、牌号/对牌后复制冻结；昵称复用1—12字素口径。RoomView独立单调更新；PlayerView仅在当前控制有效时接收，按当前RoomView.currentHandId锚定手，再比较同手handVersion。先到的新手放最多4手缓存；旧手999不能盖新手1。相同手版本仅以较新房间版本更新权限，不重写牌面和本人底牌。较新手版本即使携带较旧房间版本仍可接纳，独立RoomView不退。

未知epoch快照/ack先隔离并禁控制，当前连接有凭据时执行私有resume同步；takenOver/expired不自动同步。身份切换、断线、epoch疑变会清私人操作和旧待发动作。身份变化还清旧房间/手；同epoch切换身份时，未关联当前pending的旧失权ack不撤销新身份。

服务端确认只改pending结果，不预测余额或版本。每次发送的相同ID请求各等待一个确认；不同意图不能覆盖原pending。超时标uncertain，不自动新ID/重放；同手/turn仍有效时可显式原ID重试。断线不调用socket.emit，无离线下注队列，断线/失权取消当前等待者。身份错误ack同步撤权并清私有数据，保留凭据。

W15仍返回identityOnly/handInterrupted，未假造seatRestored。若显式join同一原席，服务端复用身份而不重复发放；120秒保座和重启归档待W22。

运行独立真实浏览器套件：npm.cmd run test:network:browser。先build，使用playwright.network.config.ts、新w20-playwright.json、独有临时SQLite，单worker/retry0，测试两个BrowserContext实际导入模块，执行开手/重复动作/结算/新标签接管。没有生产window调试接口；测试window绑定仅存在于测试注入脚本。产品首页与灰盒视觉保持原状。

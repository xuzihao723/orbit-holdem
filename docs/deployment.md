# 常驻部署

当前产物为单实例Node服务、SQLite持久卷、同域HTTP/Socket.IO、Compose与Caddy配置。没有部署到公网，也未购买主机/域名或修改DNS。本机无Docker，镜像构建、镜像digest、TLS与容器重启待在实际目标验证。

本地生产文件可用 NODE_ENV=test、WEB_DIST=apps/web/dist、DATABASE_PATH=独立路径运行编译后apps/server/dist/index.js；这是HTTP隔离演练，不能当作公网HTTPS验收。生产环境必须NODE_ENV=production、精确HTTPS WEB_ORIGIN、WEB_DIST及持久DATABASE_PATH，变量校验早于数据库启动归档。/health/live为进程探测，/health/ready检查数据库且关闭中返回不可用。

主机准备好后，在deploy/runtime-config.example.env填写实际授权域名与核验后的镜像digest。构建上下文必须poker-four根：docker compose --env-file deploy/runtime.env -f deploy/compose.yaml up -d --build。app只向内部代理开放3001；公网只80/443。不要扩为多副本，内存房间与单库不支持这种运行方式。

启动前核对数据卷node用户权限、磁盘余量、备份卷可写和DNS/TLS条件。部署后运行 npm run deploy:verify -- --origin https://实际域名；该命令只读HTTP/WS握手，不创建访客或房间。实际跨设备完整一手、WS恢复和重启中止提示仍须记录。容器停止宽限20秒，先关闭传输再清理调度/线程和队列/数据库。重启不续打旧手，旧active手归档为中止。

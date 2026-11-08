# 备份与恢复

在线备份使用独立Node子进程和node:sqlite backup，源连接只读，不启动ApplicationRuntime。父进程60秒超时只终止自己创建的worker，等待退出后清理本次staging；成功后校验integrity_check、foreign_key_check、计数和SHA256，再用独占硬链接发布数据库和清单。禁止直接复制仍在运行的SQLite主文件。

备份：npm run db:backup -- --source .data/orbit.sqlite --out backups/唯一名字.sqlite。目标和同名.json都必须不存在；不要把备份放进WEB_DIST。活跃写入导致超时则进入维护窗口停止写入后重试，不能发布半成品。

恢复检查：npm run db:restore -- --source backups/某份.sqlite --target 新目录/orbit.sqlite。默认只校验，不写目标。

实际恢复：先停止目标应用，保留原数据目录，再加 --apply --stopped。目标库及-wal/-shm均须不存在，工具不会覆盖任何已存在数据库。恢复到隔离目录和测试端口，核对已结算结果及权限、active手中止，再让部署DATABASE_PATH指向这份已验证目录。不删除未知WAL/SHM，不把测试目录设为用户库。

计划默认每天生成一份新名字备份、保留7份；自动调度与清理尚未安装。实际运维配置只能清理本工具清单覆盖的历史备份，首次不自动删除未知文件。备份文件含访客身份材料，不公开分享或放入前端目录。

包含账号表的备份会先在临时文件验证指纹，清除旧登录会话与邮箱验证挑战后发布恢复库。恢复库仍保留账号、密码摘要与牌局数据。恢复后使用邮箱和密码重新登录。

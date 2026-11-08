# 卡牌及辅助素材

assets/cards/manifest.json 映射 52 张正面、两种牌背和公共空槽。四花色共用同一逻辑编号，颜色由显示偏好决定。牌面、牌背和空槽由构建期允许列表加载。

npm run assets:generate 生成正式牌组，npm run assets:validate 校验完整映射和实际 SVG。npm run assets:contact-sheet 生成标准和四花色 13×4 校对板。四种花色、点数布局、四张 A 和十二个人物构件各有可复用源文件。

npm run assets:aux:generate 生成辅助素材及音频母版，npm run assets:audio:encode 生成 OGG 和 MP3，npm run assets:aux:validate 校验清单、许可、文件格式与解码峰值。编码器通过 FFMPEG_PATH 或本地工具目录查找。来源与许可见 assets/LICENSES.md。

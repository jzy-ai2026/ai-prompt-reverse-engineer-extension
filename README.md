# AI Prompt Reverse Engineer

Chrome/Edge 浏览器插件，用于从网页图片或本地图片反推结构化 AI 生成提示词，并支持多模板切换、中文 Prompt 预览、JSON 编辑、自然语言修改、多图参考、历史恢复参考图和 OpenAI 兼容网关配置。

## 直接下载使用

如果只是安装插件，不需要下载 GitHub 的源码 zip。请进入 [release 下载目录](./release/README.md)，下载：

```text
release/ai-prompt-reverse-engineer-extension-latest.zip
```

下载后解压，加载“解压后直接包含 manifest.json 的文件夹”。

## 安装给同事使用

完整安装说明见 [INSTALL.md](./INSTALL.md)。

1. 解压 `release/ai-prompt-reverse-engineer-extension-latest.zip`。
2. 打开 Chrome 或 Edge，进入 `chrome://extensions`。
3. 打开右上角“开发者模式”。
4. 点击“加载已解压的扩展程序”。
5. 选择解压后的文件夹，文件夹里应直接包含 `manifest.json`。

## API 配置

在插件侧边栏的设置页填写：

- API Base URL: `https://ai.leihuo.netease.com/v1`
- Model: `gemini-3.1-pro-preview-customtools`
- API Key: 公司网关 Bearer Token

API Key 只保存在浏览器本地 `chrome.storage.local`，不会写入仓库。

## 使用方式

1. 打开任意包含图片的网页。
2. 在侧边栏工作区选择模板，例如“JSON提示词反推”“风格提取”“人物参考表”“线稿”。
3. 在图片上右键，选择“反推提示词”。
4. 首次使用时确认图片或图片 URL 可发送到配置的 API 服务。
5. 等待分析完成后，可复制中文 Prompt 或编辑 PromptDocument JSON。

模板库：

- 内置 12 套专业模板：JSON提示词反推、风格提取、多图风格反推、人物参考表、角色阵容设计、物体道具参考表、资产拆分、高品质 3D 渲染、电影大师、高清细化、线稿、色稿。
- “模板”页面支持新增、编辑、删除自定义模板；内置模板不可删除，但可复制后修改。
- 右键反推、上传图片反推和批量逐张反推都会使用当前选中的单图模板。
- 多图同风格分析固定使用内置“多图风格反推”模板。

多图参考：

1. 在多张参考图上分别右键，选择“添加到多图参考”，或在侧边栏用“多选 / 文件夹”导入本地图片。
2. 打开侧边栏，在“多图参考”中确认参考图，最多保留 6 张。
3. 点击“同风格”会提取多张图共享的视觉风格，输出 `source.type=style_common`。
4. 点击“批量”会逐张反推，并为每张图片生成一条历史记录。

底部输入框支持两种修改方式：

- 快捷字段修改：`style=赛博朋克`
- 自然语言修改：`把色调改成暖色，主体换成一只猫`
- 编辑模式支持自动判断、文本编辑、视觉参考。指令包含“参考原图”“按原图”“保持原图风格”“根据图片”“像原图一样”时，会自动使用视觉参考模式。

## 本地开发

```bash
npm install
npm run typecheck
npm run build
```

构建产物输出到 `dist/`。

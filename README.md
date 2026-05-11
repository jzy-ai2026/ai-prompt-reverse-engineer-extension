# AI Prompt Reverse Engineer

Chrome/Edge 浏览器插件 MVP，用于从网页图片反推结构化 AI 生成提示词，并支持中文 Prompt 预览、JSON 编辑、历史记录和 OpenAI 兼容网关配置。

## 安装给同事使用

完整安装说明见 [INSTALL.md](./INSTALL.md)。

1. 解压 `release/ai-prompt-reverse-engineer-extension-v0.1.0.zip`。
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
2. 在图片上右键，选择“反推提示词”。
3. 首次使用时确认图片或图片 URL 可发送到配置的 API 服务。
4. 等待分析完成后，可复制中文 Prompt 或编辑 PromptDocument JSON。

底部输入框支持两种修改方式：

- 快捷字段修改：`style=赛博朋克`
- 自然语言修改：`把色调改成暖色，主体换成一只猫`

## 本地开发

```bash
npm install
npm run typecheck
npm run build
```

构建产物输出到 `dist/`。

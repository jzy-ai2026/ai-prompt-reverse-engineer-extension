# AI Prompt Reverse Engineer

Chrome/Edge 浏览器插件，用于从网页图片、本地图片或多张参考图中反推结构化 AI 生成提示词，并支持 **Nano Banana Pro 提示词助手**、多模板切换、中文 Prompt 预览、JSON 编辑、自然语言修改、多图参考、历史恢复参考图和 OpenAI 兼容网关配置。

## 直接下载使用

如果只是安装插件，不需要下载 GitHub 的源码 zip。请进入 [release 下载目录](./release/README.md)，下载最新版插件包：

```text
release/ai-prompt-reverse-engineer-extension-latest.zip
```

下载后解压，加载“解压后直接包含 `manifest.json` 的文件夹”。

## 给同事的教程

- 完整安装与使用教程：[INSTALL.md](./INSTALL.md)
- 插件功能介绍：[FEATURES.zh.md](./FEATURES.zh.md)
- 最新版本下载与更新说明：[release/README.md](./release/README.md)

## 核心功能

- **图片提示词反推**：右键网页图片或上传本地图片，生成中文 Prompt 和结构化 PromptDocument JSON。
- **Nano Banana Pro 提示词助手**：输入中文想法、参考图、画幅、分辨率和限制条件，生成可直接复制的英文提示词，并提供中文核对。
- **多图参考**：最多加入 6 张参考图，支持逐张删除、复制、拖拽排序、同风格分析、批量逐张反推和助手参考图。
- **模板库**：内置 12 套专业模板，可复制后改成团队自己的模板。
- **自然语言二次修改**：用中文指令继续调整 PromptDocument，必要时可带视觉参考。
- **历史记录**：保存最近结果，支持恢复 Prompt、JSON 和参考图。
- **OpenAI 兼容网关**：可配置公司内部 AI 网关、模型名和 API Key。

## 提示词助手快速上手

1. 点击插件顶部第二个“提示词助手”入口。
2. 选择任务类型：`自动判断`、`文生图`、`图文生成` 或 `编辑图片`。
3. 在“想法”里写中文需求，例如：

```text
生成一个国风武侠场景，角色站在雨夜古街中央，画面有电影海报质感。
```

4. 选择画幅比例和分辨率，常用组合是 `16:9 + 2K`、`4:5 + 2K` 或 `9:16 + 2K`。
5. 如果要保留人物、角色或产品一致性，打开“身份锁定”。
6. 如有参考图，拖入、粘贴或点击上传，可以逐张复制、删除、拖拽排序，并给每张图指定参考角色，例如“身份参考”“风格参考”“构图参考”。
7. 点击“生成提示词”，复制右侧的最终英文提示词。
8. 用“中文核对”检查英文 Prompt 是否准确表达了中文需求。

## API 配置

在插件侧边栏的设置页填写：

- API Base URL: `https://ai.leihuo.netease.com/v1`
- Model: `gemini-3.1-pro-preview-customtools`
- API Key: 公司网关 Bearer Token

API Key 只保存在浏览器本地 `chrome.storage.local`，不会写入仓库。

## 本地开发

```bash
npm install
npm run typecheck
npm run build
```

构建产物输出到 `dist/`。

# 最新版本下载与更新说明

这里放的是可以直接安装的 Chrome/Edge 插件包。给同事安装时，请发送下面的**插件 zip 直达链接**，不要让同事使用 GitHub 绿色按钮里的 `Download ZIP`，那个下载的是源码包，不能直接作为浏览器插件加载。

## 推荐下载

| 用途 | 链接 | 说明 |
| --- | --- | --- |
| 最新稳定版 | [下载 v0.4.5 插件 zip](./ai-prompt-reverse-engineer-extension-v0.4.5.zip) | 推荐发给同事，固定版本，便于回溯 |
| 最新版备份包 | [下载 latest 插件 zip](./ai-prompt-reverse-engineer-extension-latest.zip) | 当前内容与 `v0.4.5` 相同 |

- 当前最新版本：`v0.4.5`
- 更新时间：`2026-06-04`
- 插件包大小：`194,392 bytes`，约 `190 KB`

## 最近更新

### v0.4.5：多窗口工作区与任务队列

- 新增弹窗任务窗口，插件图标和快捷键可直接打开独立工作区。
- 多个工作区按 `workspaceId` 隔离多图参考队列、任务状态和结果广播。
- 浮窗支持绑定独立工作区，拖到窗口边缘可分离为弹窗工作区。
- 右键菜单新增“复制当前标签页到任务窗口”，可把当前页面截图送入独立任务窗口分析。
- 新增任务排队状态和并发任务设置，设置页可在 `1-4` 个并发任务之间切换，默认 `2` 个。
- 文档补充 GPT-Image-2 提示词助手、图生图中文 Prompt、雷火网关 `gpt-5.5` 模型预设说明。

### v0.4.4：GPT-Image-2 提示词助手增强

- GPT-Image-2 助手新增 `参考图优化` 和 `无图 Prompt 草案` 两种任务模式。
- 无图草案输出六模块强分段 Prompt，强化文字、画幅、构图和限制条件可控性。
- 参考图优化继续保留 `subject_image` / `reference_image` 角色逻辑，输出自然段 `optimized_prompt` 和 `reference_summary`。
- 新增画面类型、优化强度、文字策略和默认关闭的游戏用途增强。
- 新增 GPT-Image-2 字段的历史、收藏和草稿恢复兼容。

### v0.4.3：Midjourney V8.1 提示词助手

- 提示词助手新增引擎切换：`Nano Banana Pro` / `Midjourney V8.1`。
- Midjourney V8.1 默认输出 `--v 8.1`，参数统一放在末尾。
- 自动清理 V8.1 不支持的 `--q`、`--cref`、`--cw`、`--oref`、`--ow`、`--draft` 和 `::` 多重提示。
- 支持 Raw、探索 SD / 定稿 HD、Stylize、Chaos、Weird、Seed、Personalization 和 Negative Prompt。
- 新增 [Midjourney V8.1 助手教程](../MIDJOURNEY_ASSISTANT_USAGE.zh.md)，说明参数边界、参考图规则和示例 Prompt。

## 插件能做什么

- **图片提示词反推**：右键网页图片或上传本地图片，生成中文 Prompt 和结构化 JSON。
- **提示词助手**：输入中文想法、参考图、画幅和限制条件，生成 Nano Banana Pro / Midjourney V8.1 英文 Prompt，或 GPT-Image-2 中文优化 Prompt。
- **多图参考**：最多加入 6 张参考图，支持逐张复制、删除、拖拽排序、同风格分析、批量反推和助手参考图。
- **模板库**：内置专业模板，可复制后改成团队自己的模板。
- **历史记录**：保存最近结果，支持恢复 Prompt、JSON、助手结果和参考图。

## 安装步骤

1. 下载上方的插件 zip。
2. 解压 zip。
3. 打开 `chrome://extensions` 或 `edge://extensions`。
4. 打开“开发者模式”。
5. 点击“加载已解压的扩展程序”。
6. 选择解压后的文件夹，文件夹里应该直接包含 `manifest.json`。

## 包体结构

解压后应直接看到：

```text
manifest.json
background.js
content.js
sidepanel.html
assets/
icons/
```

如果看到的是项目源码文件，例如 `src/`、`package.json`、`vite.config.ts`，说明下载错了，请重新下载上方的插件 zip。

## 推荐给同事的话术

> 请下载 `v0.4.5` 插件 zip，解压后在 Chrome/Edge 的扩展程序页面打开“开发者模式”，选择“加载已解压的扩展程序”，然后选中解压后直接包含 `manifest.json` 的文件夹。新版支持多窗口任务工作区、多任务并发队列，以及 Nano Banana Pro、Midjourney V8.1、GPT-Image-2 提示词助手。

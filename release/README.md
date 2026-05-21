# 最新版本下载与更新说明

这里放的是可以直接安装的 Chrome/Edge 插件包。给同事安装时，请发送下面的**插件 zip 直达链接**，不要让同事使用 GitHub 绿色按钮里的 `Download ZIP`，那个下载的是源码包，不能直接作为浏览器插件加载。

## 推荐下载

| 用途 | 链接 | 说明 |
| --- | --- | --- |
| 最新稳定版 | [下载 v0.4.3 插件 zip](./ai-prompt-reverse-engineer-extension-v0.4.3.zip) | 推荐发给同事，固定版本，便于回溯 |
| 最新版备份包 | [下载 latest 插件 zip](./ai-prompt-reverse-engineer-extension-latest.zip) | 当前内容与 `v0.4.3` 相同 |

- 当前最新版本：`v0.4.3`
- 更新时间：`2026-05-21`
- 插件包大小：约 `150 KB`

## 最近更新

### v0.4.3：Midjourney V8.1 双引擎助手

- 提示词助手新增引擎切换：`Nano Banana Pro` / `Midjourney V8.1`。
- Midjourney V8.1 引擎默认输出 `--v 8.1`，参数统一放在末尾，并清理 V8.1 不支持的 `--q`、`--cref`、`--cw`、`--oref`、`--ow`、`--draft` 和 `::` 多重提示。
- 新增 MJ 参数区：Raw、探索 SD / 定稿 HD、Stylize、Chaos、Weird、Seed、Personalization 和 Negative Prompt。
- 参考图继续复用现有队列：风格参考生成 `--sref`，普通参考图作为 image prompt，占位本地图片并提示先上传获取可用 URL。
- 新增 [Midjourney V8.1 助手教程](../MIDJOURNEY_ASSISTANT_USAGE.zh.md)，说明参数边界、参考图规则和示例 Prompt。

### v0.4.1：中文核对增强

- Nano Banana Pro 助手生成英文提示词后，新增**中文核对**区域。
- 中文核对包含语义回译、核对清单和可能需要确认的问题，方便检查英文 Prompt 是否准确表达了中文需求。
- 参考图队列支持逐张复制、删除和拖拽排序，方便精细增减多图参考。
- 本地参考图导入会先压缩，避免多图上传时触发浏览器存储配额错误。
- 历史记录兼容旧数据：旧记录没有中文核对时，会显示明确的空状态提示。
- 更新 `latest.zip` 和 `v0.4.1.zip` 插件包。

### v0.4.0：浮动面板与工作流升级

- 新增网页内浮动面板体验，普通网页中可直接打开插件工作台。
- 在受限页面中自动回退到浏览器侧边栏，避免打开失败。
- 优化图片处理、模型调用、批量分析和编辑任务的进度提示。
- 强化 Nano Banana Pro 助手、多图参考导入、模板工作流和移动端/浮窗样式。
- 更新 `latest.zip` 和 `v0.4.0.zip` 插件包。

## 插件能做什么

- **图片提示词反推**：右键网页图片或上传本地图片，生成中文 Prompt 和结构化 JSON。
- **双引擎提示词助手**：输入中文想法、参考图、画幅和限制条件，生成 Nano Banana Pro 或 Midjourney V8.1 可直接复制的英文提示词。
- **Midjourney V8.1 参数保护**：自动输出 `--v 8.1`，支持 `--raw`、`--sd/--hd`、`--s`、`--c`、`--w`、`--seed`、`--sref`、`--iw` 和 `--no`。
- **中文核对**：把英文提示词回译成中文，并列出核对清单和可能需要确认的问题。
- **多图参考**：最多加入 6 张参考图，支持逐张复制、删除、拖拽排序、同风格分析、批量逐张反推和助手参考图。
- **模板库**：内置 12 套专业模板，可复制后改成团队自己的模板。
- **历史记录**：保存最近结果，支持恢复 Prompt、JSON、助手结果和参考图。

## 提示词助手快速教程

1. 安装插件后，点击插件顶部第二个入口“提示词助手”。
2. 选择引擎：`Nano Banana Pro` 或 `Midjourney V8.1`。
3. 选择任务类型：`自动判断`、`文生图`、`图文生成` 或 `编辑图片`。
4. 在“想法”里写中文需求，例如：

```text
生成一个国风武侠场景，角色站在雨夜古街中央，画面有电影海报质感。
```

5. 选择画幅比例。Nano Banana Pro 选择 `1K/2K/4K`，Midjourney V8.1 选择 `探索 SD` 或 `定稿 HD`。
6. 如有参考图，拖入、粘贴或点击上传，可以逐张复制、删除、拖拽排序，并给每张图指定参考角色。
7. 如果要保留人物、角色或产品一致性，打开“身份锁定”。MJ V8.1 会在中文核对里提示它不支持 `--cref/--oref`。
8. 在“规格补充”里写不能改的内容、画面文字、品牌限制或禁用元素。
9. 点击“生成提示词”或“生成 MJ Prompt”，复制右侧“最终英文提示词”。
10. 用“中文核对”检查英文 Prompt 是否准确表达了中文需求和参数选择。

完整教程见 [INSTALL.md](../INSTALL.md)，完整功能说明见 [FEATURES.zh.md](../FEATURES.zh.md)，Midjourney 专项教程见 [MIDJOURNEY_ASSISTANT_USAGE.zh.md](../MIDJOURNEY_ASSISTANT_USAGE.zh.md)。

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

如果你看到的是项目源码文件，例如 `src/`、`package.json`、`vite.config.ts`，说明下载错了，请重新下载上面的插件 zip。

## 推荐给同事的话术

> 请下载 `v0.4.3` 插件 zip，解压后在 Chrome/Edge 的扩展程序页面打开“开发者模式”，选择“加载已解压的扩展程序”，然后选中解压后直接包含 `manifest.json` 的文件夹。新版提示词助手支持 Nano Banana Pro 和 Midjourney V8.1 两个引擎。

# 下载与安装

这里放的是可以直接安装的 Chrome/Edge 扩展包。不要使用 GitHub 绿色按钮里的 `Download ZIP` 安装插件，那个是源码包。

## 推荐下载

- 最新版：`ai-prompt-reverse-engineer-extension-latest.zip`
- 固定版本：`ai-prompt-reverse-engineer-extension-v0.3.1.zip`

两者当前内容相同。`latest` 适合同事直接下载，固定版本适合归档。

## 安装步骤

1. 下载 zip。
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

如果你看到的是项目源码文件，例如 `src/`、`package.json`、`vite.config.ts`，说明下载错了，请重新下载本目录下的插件 zip。

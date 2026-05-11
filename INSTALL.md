# AI Prompt Reverse Engineer 插件安装说明

## 1. 下载插件安装包

从 GitHub 仓库下载插件压缩包：

https://github.com/jzy-ai2026/ai-prompt-reverse-engineer-extension

在仓库中找到：

```text
release/ai-prompt-reverse-engineer-extension-v0.1.0.zip
```

下载后解压到本地文件夹。解压后的文件夹中应直接包含：

```text
manifest.json
background.js
content.js
sidepanel.html
assets/
```

## 2. 在 Chrome 中加载插件

1. 打开 Chrome 浏览器。
2. 在地址栏输入：

```text
chrome://extensions
```

3. 打开右上角的“开发者模式”。
4. 点击“加载已解压的扩展程序”。
5. 选择刚才解压后的插件文件夹。
6. 页面中出现 `AI Prompt Reverse Engineer` 即表示安装成功。

## 3. 在 Edge 中加载插件

1. 打开 Edge 浏览器。
2. 在地址栏输入：

```text
edge://extensions
```

3. 打开“开发人员模式”。
4. 点击“加载解压缩的扩展”。
5. 选择刚才解压后的插件文件夹。

## 4. 配置 API

安装后打开插件侧边栏，进入“设置”页面，填写：

```text
API Base URL: https://ai.leihuo.netease.com/v1
Model: gemini-3.1-pro-preview-customtools
API Key: 你的公司网关 Bearer Token
```

填写完成后点击保存。

API Key 只会保存在当前浏览器本地，不会写入 GitHub 仓库或插件代码。

## 5. 使用插件

1. 打开任意包含图片的网页。
2. 在目标图片上点击右键。
3. 选择“反推提示词”。
4. 首次使用时，插件会提示“图片/URL 将发送至你配置的 API 服务”。
5. 点击“本次允许”或“记住选择”。
6. 等待分析完成后，侧边栏会显示中文提示词和结构化 JSON。

## 6. 编辑提示词

底部输入框支持两种编辑方式。

快捷字段修改：

```text
style=赛博朋克
色调=暖色
主体=一只橘猫
```

自然语言修改：

```text
把画面风格改成赛博朋克，色调换成暖色，主体换成一只猫
```

快捷字段修改会在本地立即生效；自然语言修改会调用 API 重新生成完整 JSON。

## 7. 常见问题

### 右键菜单没有出现

刷新当前网页后再试一次。插件只会在图片上右键时显示“反推提示词”。

### 提示 API 请求失败

请检查设置页中的三项配置：

```text
API Base URL: https://ai.leihuo.netease.com/v1
Model: gemini-3.1-pro-preview-customtools
API Key: 是否填写正确
```

### 提示图片跨域限制

部分网站的图片无法被插件读取。可以先下载图片，然后在插件的“参考图片”区域点击上传按钮，选择本地图片进行分析。

### 更新插件版本

1. 下载新版 zip。
2. 解压到新的文件夹，或覆盖旧文件夹。
3. 打开 `chrome://extensions`。
4. 点击 `AI Prompt Reverse Engineer` 卡片上的“重新加载”按钮。

## 8. 卸载插件

进入 `chrome://extensions`，找到 `AI Prompt Reverse Engineer`，点击“移除”即可。

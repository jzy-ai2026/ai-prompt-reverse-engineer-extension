# AI Prompt Reverse Engineer 安装与使用教程

这个插件用于在网页图片上右键反推 AI 生成提示词，并输出中文 Prompt 和结构化 JSON。

适用浏览器：

- Chrome 120+
- Edge 120+

## 一、下载插件

打开 GitHub 仓库：

```text
https://github.com/jzy-ai2026/ai-prompt-reverse-engineer-extension
```

下载插件压缩包：

```text
release/ai-prompt-reverse-engineer-extension-v0.1.0.zip
```

下载后先解压。解压完成后，文件夹里应该能直接看到这些文件：

```text
manifest.json
background.js
content.js
sidepanel.html
assets/
README.md
```

注意：加载插件时要选择“包含 manifest.json 的那个文件夹”，不要选择 zip 文件本身，也不要选择它的上一级目录。

## 二、在 Chrome 中安装

1. 打开 Chrome。
2. 在地址栏输入：

```text
chrome://extensions
```

3. 打开右上角的“开发者模式”。
4. 点击“加载已解压的扩展程序”。
5. 选择刚才解压出来的插件文件夹。
6. 页面里出现 `AI Prompt Reverse Engineer`，说明安装成功。

## 三、在 Edge 中安装

1. 打开 Edge。
2. 在地址栏输入：

```text
edge://extensions
```

3. 打开“开发人员模式”。
4. 点击“加载解压缩的扩展”。
5. 选择刚才解压出来的插件文件夹。
6. 页面里出现 `AI Prompt Reverse Engineer`，说明安装成功。

## 四、首次配置 API

安装成功后，点击浏览器工具栏里的插件图标，打开插件侧边栏。

进入“设置”页面，填写：

```text
API Base URL: https://ai.leihuo.netease.com/v1
Model: gemini-3.1-pro-preview-customtools
API Key: 你的公司 AI 网关 Bearer Token
```

填写完成后点击保存。

说明：

- API Key 只保存在你自己的浏览器本地。
- API Key 不会上传到 GitHub，也不会写入插件代码。
- 如果不知道 API Key，请联系公司内部 AI 网关管理员。

## 五、反推图片提示词

1. 打开一个包含图片的网页。
2. 在目标图片上点击右键。
3. 点击菜单里的“反推提示词”。
4. 首次使用时，插件会提示：

```text
图片/URL 将发送至你配置的 API 服务
```

5. 点击“本次允许”或“记住选择”。
6. 等待模型分析完成。
7. 侧边栏会显示：

- 参考图片
- 中文 Prompt 预览
- PromptDocument JSON
- 历史记录

## 六、复制结果

分析完成后可以复制两种内容：

- 复制 Prompt：适合直接粘贴到 AI 绘画或视频生成工具中。
- 复制 JSON：适合保存结构化分析结果，或继续做二次编辑。

## 七、修改提示词

底部输入框支持两种修改方式。

### 方式一：快捷字段修改

适合快速改某个字段：

```text
style=赛博朋克
色调=暖色
主体=一只橘猫
光影=电影感逆光
```

这种方式会在本地立即修改 JSON，不会额外调用 API。

### 方式二：自然语言修改

适合一次性改多个维度：

```text
把画面风格改成赛博朋克，色调换成暖色，主体换成一只猫
```

这种方式会调用 API，让模型返回修改后的完整 JSON。

## 八、历史记录

插件会保留最近 20 条结果。

进入“历史记录”页面可以：

- 查看之前反推过的 Prompt
- 点击历史项恢复到工作区
- 删除单条历史
- 清空全部历史

## 九、常见问题

### 1. 右键菜单没有出现

请刷新网页后再试一次。插件菜单只会在图片上右键时出现。

### 2. 提示 API 请求失败

请先检查设置页：

```text
API Base URL 是否为：https://ai.leihuo.netease.com/v1
Model 是否为：gemini-3.1-pro-preview-customtools
API Key 是否填写正确
```

如果仍然失败，截图红色错误框发给插件维护者排查。

### 3. 提示图片跨域限制

部分网站的图片无法被插件直接读取。可以这样处理：

1. 先把图片下载到本地。
2. 打开插件侧边栏。
3. 在“参考图片”区域点击上传按钮。
4. 选择本地图片重新分析。

### 4. 反推出的内容不是中文

请确认已经安装最新版本插件。新版会要求模型输出简体中文 Prompt。

### 5. 更新插件版本

1. 下载新版 zip。
2. 解压并覆盖旧文件夹，或解压到一个新文件夹。
3. 打开：

```text
chrome://extensions
```

4. 找到 `AI Prompt Reverse Engineer`。
5. 点击卡片上的“重新加载”按钮。

如果你换了新的文件夹，也可以先移除旧插件，再重新“加载已解压的扩展程序”。

## 十、卸载插件

进入：

```text
chrome://extensions
```

找到 `AI Prompt Reverse Engineer`，点击“移除”即可。

# Midjourney V8.1 提示词助手使用说明

## 适合什么时候用

Midjourney V8.1 助手适合把中文创意整理成可直接复制到 Midjourney 的英文 Prompt。它默认输出 `--v 8.1`，并按 V8.1 规则把参数统一放在提示词末尾。

常见用途：

- 写实电影场景、3A 游戏实机画面、建筑摄影、产品摄影。
- 国风武侠、古代场景、世界观设定和角色设定图。
- 把“好看的光”“真实感”“震撼构图”转成具体摄影和电影术语。
- 用参考图控制风格、构图或画面方向。

## 插件内使用流程

1. 打开插件顶部第二个入口“提示词助手”。
2. 在引擎切换中选择 `Midjourney V8.1`。
3. 写下中文想法，例如：

```text
国风武侠竹林电影画面，两名侠客在夕阳雾气中飞身交手，写实电影剧照。
```

4. 选择画幅比例。电影场景常用 `16:9`，史诗分镜常用 `21:9`，人像常用 `3:4`，全身角色常用 `2:3`，产品图常用 `4:5`。
5. 选择输出质量：`探索 SD` 适合快速找方向，`定稿 HD` 适合高细节候选。
6. 按需要调整 Raw、Stylize、Chaos、Weird、Seed、Personalization 和 Negative Prompt。
7. 如有参考图，拖入或粘贴到参考图区域，并给每张图指定角色。
8. 点击“生成 MJ Prompt”，复制右侧最终英文提示词。

## V8.1 参数规则

默认合法参数：

```text
--ar 16:9 --v 8.1 --raw --hd --s 120
```

推荐组合：

- 电影场景：`--ar 16:9 --v 8.1 --raw --hd --s 120`
- 史诗分镜：`--ar 21:9 --v 8.1 --raw --hd --s 150`
- 人像角色：`--ar 3:4 --v 8.1 --raw --hd --s 150`
- 全身角色：`--ar 2:3 --v 8.1 --raw --hd --s 150`
- 商业摄影：`--ar 4:5 --v 8.1 --raw --hd --s 80`
- 快速探索：`--ar 16:9 --v 8.1 --raw --sd --s 150`

V8.1 不应使用：

```text
--q
--quality
--cref
--cw
--oref
--ow
--draft
::
--niji 7 和 --v 8.1 混用
```

插件会尽量清理这些旧参数，并在中文核对里提示原因。

## 参考图规则

- 风格参考会转成 `--sref <url> --sw 100`。
- 构图、场景、产品、材质等普通参考图会作为 Image Prompt 放在提示词开头，并配合 `--iw 1`。
- 本地图片、剪贴板图片和 `data:image/...` 不能直接作为 MJ URL 使用。插件会输出 `<image-1-url>` 这类占位符，使用前需要先把图片上传到 Midjourney 或 Discord，再替换为真实 URL。
- V8.1 不支持 `--cref`、`--cw`、`--oref`、`--ow`。如果必须做强角色一致性，建议另开 V7 工作流。

## 输出示例

```text
A cinematic Chinese wuxia film still, two ancient martial artists performing graceful aerial swordplay in a dense bamboo forest, flowing robes suspended in motion, bamboo leaves swirling through golden sunset light, mossy stone path below, shallow stream reflections, misty mountain background, a small ancient pavilion with curved eaves hidden between bamboo stalks, mysterious jianghu atmosphere, wide cinematic composition, low-angle camera, soft natural backlight, volumetric mist, subject sharp, realistic historical costume texture --ar 16:9 --v 8.1 --raw --hd --s 150 --no text, logo, watermark, modern buildings, modern clothing, sci-fi elements, UI
```

## 官方依据

- Midjourney Version: https://docs.midjourney.com/hc/en-us/articles/32199405667853-Version
- Style Reference: https://docs.midjourney.com/hc/en-us/articles/32180011136653-Style-Reference
- Image Prompts: https://docs.midjourney.com/hc/en-us/articles/32040250122381-Image-Prompts
- Text Generation: https://docs.midjourney.com/hc/en-us/articles/32502277092109-Text-Generation
- Multi-Prompts & Weights: https://docs.midjourney.com/hc/en-us/articles/32658968492557-Multi-Prompts-Weights

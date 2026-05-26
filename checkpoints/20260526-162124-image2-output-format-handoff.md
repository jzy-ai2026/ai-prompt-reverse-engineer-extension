# Image-2 提示词助手输出格式修正交接

时间：2026-05-26 16:21:24

## 当前目标

继续开发 GPT-Image-2 提示词助手，修正 `draft` 无图草案和 `reference` 参考图优化输出契约混用的问题。

用户确认的方向：

- `draft` 无图 Prompt 草案必须使用强分段六模块。
- `reference` 参考图优化继续使用 3-4 个自然段，并输出 `optimized_prompt` + `reference_summary`。
- 游戏用途增强不新增独立段落，按用途合并进六模块或 reference 自然段。

## 已完成

主要改动文件：

- `src/lib/openaiClient.ts`
- `src/lib/storage.ts`
- `src/sidepanel/components/NanoBananaAssistant.tsx`
- `src/sidepanel/styles.css`

已经完成的功能：

- GPT-Image-2 增加 `taskMode: draft | reference`。
- `draft` 无图草案不再要求参考图。
- `reference` 参考图优化仍要求参考图。
- 新增 layout/text/strength/game 控制字段并接入 UI、请求和存储恢复。
- `draft` 走 schema parser -> normalize -> renderer -> audit。
- `reference` 保留 subject/reference image 角色逻辑。
- `draft` renderer 已切换为强分段六模块：

```text
【图像类型】
【主体】
【场景背景】
【构图与风格】
【文字要求】
【限制条件】
```

- `reference` 仍使用 `GPT_IMAGE_2_REFERENCE_OPTIMIZER_SYSTEM_PROMPT`，要求自然段 `optimized_prompt` 和 `reference_summary`。
- 新增 draft 专用审计：
  - 六模块齐全。
  - 六模块顺序正确。
  - `【文字要求】` 独立存在。
  - 指定文案保留。
  - `textPolicy=none` 不诱导文字区。
  - 游戏用途关键语义命中。
- 新增 draft 专用轻修复：
  - 缺文字约束时补进 `【文字要求】`。
  - 缺画幅、额外文字限制、游戏语义时补进 `【限制条件】`。

## 已验证

在最后一次完整验证中通过：

```bash
npm run typecheck
npm run build
```

UI smoke 已验证：

- `draft` 无参考图，输入想法后可生成。
- `reference` 无参考图仍禁用。
- draft 模式显示 `参考图（可选）`。
- reference 模式仍显示参考图必填提示。

## 下一步建议

1. 继续围绕两个 spec 检查 `draft` 六模块输出和 `reference` 自然段输出是否稳定。
2. 补充最小 prompt 验收样例，覆盖海报、纯画面、指定文案、游戏内效果图和参考图优化。
3. 如需要，再优化 `draft` 的六模块 renderer 细节，但不要把 `reference` 的自然段规则混入 `draft`。
4. 完成后重新跑 `npm run typecheck`、`npm run build` 和 UI smoke。

## 新对话恢复提示词

```text
请继续开发 `C:\Users\jiapeng02\Documents\New project` 里的 Image-2 提示词助手。

先阅读 checkpoint：
`C:\Users\jiapeng02\Documents\New project\checkpoints\20260526-162124-image2-output-format-handoff.md`

当前重点：
1. 不要回滚已有改动。
2. 保持 draft 输出强分段六模块，reference 输出自然段 optimized_prompt + reference_summary。
3. 按两个 spec 继续补 prompt 验收样例和必要的 renderer/audit 调整。
4. 跑 `npm run typecheck`、`npm run build`。
5. 完成后做 UI smoke：draft 无参考图可生成，reference 无参考图禁用。
```

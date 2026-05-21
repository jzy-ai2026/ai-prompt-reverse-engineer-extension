# AI Prompt Reverse Engineer v0.4.3 MJ/Favorites Handoff

Date: 2026-05-22 01:24:49 Asia/Shanghai

## Current milestone

Branch: `codex/v0-4-3-midjourney-v81`

Remote: `origin https://github.com/jzy-ai2026/ai-prompt-reverse-engineer-extension.git`

Baseline before this save: `982f30a feat: add Midjourney V8.1 prompt assistant` (`v0.4.3`)

## Completed in this checkpoint

- Added Midjourney V8.1 free aspect-ratio support in the prompt assistant.
  - MJ mode now accepts integer ratios such as `7:3`, `85:110`, and `1920:1080`.
  - Input normalization supports full-width digits/colon plus `7 / 3` and `7x3`.
  - Invalid ratios such as `1.39:1`, `0:3`, or empty values block generation instead of silently falling back.
  - MJ parameter presets now optionally save and restore `aspectRatio`; old presets keep current ratio unchanged.
- Added assistant prompt favorites.
  - Current results and assistant-history items can be saved as favorites.
  - Favorites are stored separately from the recent assistant history and can be restored into editable assistant state.
  - Restore includes engine, mode, idea, aspect ratio, MJ params, negative prompt, reverse context, result, and reference roles/images when available.
  - Duplicate favorites are keyed by `engine + finalPrompt` and update the existing favorite instead of creating duplicates.
- Preserved existing prompt-assistant enhancements already present in the working tree:
  - Reverse JSON handoff into MJ/Nano assistant.
  - Draft persistence and MJ parameter preset UI.
  - Multi-select quick edit targets and prompt preview handoff controls.

## Files included in the intended commit

- `src/background/index.ts`
- `src/lib/openaiClient.ts`
- `src/lib/storage.ts`
- `src/sidepanel/App.tsx`
- `src/sidepanel/components/InstructionInput.tsx`
- `src/sidepanel/components/NanoBananaAssistant.tsx`
- `src/sidepanel/components/PromptPreview.tsx`
- `src/sidepanel/styles.css`
- `checkpoints/20260522-012449-v043-mj-favorites-github-handoff.md`

## Validation

Passed before saving:

```powershell
npm run typecheck
npm run build
git diff --check
```

## Deliberately not included

The workspace contains existing untracked local materials that are not part of this version save:

- `.playwright-cli/`
- `CANVAS_PROMPT_FEATURE_REQUIREMENTS.zh.md`
- `INFINITE_CANVAS_TO_PS_WORKFLOW.zh.html`
- `INFINITE_CANVAS_TO_PS_WORKFLOW.zh.md`
- `PLUGIN_SHARE_INTRO.zh-analysis.md`
- `PLUGIN_SHARE_INTRO.zh.md`
- `infographic/`
- `release/README-analysis.md`
- `release/README-formatted.md`
- `release/prompt-assistant-source-v0.4.1-20260514-174542/`
- `提示词助手源码包.zip`

## Resume prompt

Continue from `C:\Users\jiapeng02\Documents\New project\checkpoints\20260522-012449-v043-mj-favorites-github-handoff.md`.
The current milestone is the v0.4.3 prompt assistant branch with MJ custom ratios and assistant prompt favorites implemented and validated. Start by checking `git status -sb`, then inspect the latest commit and remote branch before making further changes.

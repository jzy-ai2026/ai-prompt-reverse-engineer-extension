# MJ Visual Recipes v2 GitHub Handoff

Date: 2026-05-22
Workspace: `C:\Users\jiapeng02\Documents\New project`
Branch: `codex/v0-4-3-midjourney-v81`
Remote: `origin https://github.com/jzy-ai2026/ai-prompt-reverse-engineer-extension.git`

## Milestone

Implemented the MJ V8.1 optional visual recipe expansion from the v2 plan:

- Added independent optional panels for composition/camera and color/tone.
- Kept the existing lighting/shadow panel and fixed the default behavior so automatic matching is only a suggestion.
- All recipe layers are disabled by default.
- When a recipe layer is disabled, it does not pass recipe data, inject prompt fragments, or merge recipe negative terms into `--no`.
- Nano Banana Pro remains unaffected by these MJ-only controls.
- Final MJ prompt merge order is user idea, composition, lighting, color, then MJ parameters.

## Intended Commit Scope

Only these files belong to this saved version:

- `src/lib/openaiClient.ts`
- `src/lib/storage.ts`
- `src/sidepanel/components/NanoBananaAssistant.tsx`
- `src/sidepanel/styles.css`
- `checkpoints/20260522-mj-visual-recipes-github-handoff.md`

## Verification Already Run

- `npm run typecheck` passed.
- `npm run build` passed.
- `git diff --check` passed; Git only reported LF-to-CRLF warnings.

Browser/live UI verification was not run in this pass because the Browser tool was not exposed in the active tool context.

## Worktree Notes

The working tree had unrelated untracked files before this save step. They should stay uncommitted unless the user explicitly asks to include them:

- `.playwright-cli/`
- `CANVAS_PROMPT_FEATURE_REQUIREMENTS.zh.md`
- `INFINITE_CANVAS_TO_PS_WORKFLOW.zh.html`
- `INFINITE_CANVAS_TO_PS_WORKFLOW.zh.md`
- `PLUGIN_SHARE_INTRO.zh-analysis.md`
- `PLUGIN_SHARE_INTRO.zh.md`
- `checkpoints/20260514-165325-plugin-share-handoff.md`
- `infographic/`
- `release/README-analysis.md`
- `release/README-formatted.md`
- `release/prompt-assistant-source-v0.4.1-20260514-174542/`
- `prompt assistant source package zip` shown with escaped non-ASCII bytes in Git status output.

## Resume Prompt

Continue from `C:\Users\jiapeng02\Documents\New project` on branch `codex/v0-4-3-midjourney-v81`. The MJ V8.1 visual recipe v2 feature has been implemented with optional composition, lighting, and color recipe layers. First check `git status -sb` and keep unrelated untracked files out of any new commit unless the user asks. The relevant implementation files are `src/lib/openaiClient.ts`, `src/lib/storage.ts`, `src/sidepanel/components/NanoBananaAssistant.tsx`, and `src/sidepanel/styles.css`. Validation passed with `npm run typecheck`, `npm run build`, and `git diff --check`.

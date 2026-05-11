# Design System - AI Prompt Reverse Engineer Extension

## Product Context
- Chrome/Edge side panel extension for image prompt reverse engineering, template switching, JSON editing, and natural-language prompt modification.
- Primary users are AI image creators who need fast, repeatable analysis while browsing reference images.
- The UI should feel like a production creative tool: compact, precise, calm, and trustworthy.

## Design Direction
- Direction: professional creative workstation.
- Layout: input and reference image on the left, generated result on the right when space allows; stacked panels in the browser side panel.
- Density: compact but not cramped. Every panel should support repeated daily use.
- Decoration: minimal. Use borders, spacing, state color, and subtle shadows instead of decorative art.

## Interaction Model
- Top navigation switches between workspace, history, templates, and settings.
- Workspace is the default surface. It contains status, template selection, image input, result view, and edit command.
- Result view uses Prompt / JSON tabs so users do not need to scroll past both outputs every time.
- Empty image area is clickable as an upload action.
- Natural-language edit bar stays sticky at the bottom and offers quick intent chips for common edits.
- Edit mode is visible as a badge: text editing for faster JSON-only changes, visual reference when the instruction requires the original image.

## Color
- Background: `#f3f5f8`
- Surface: `#ffffff`
- Soft surface: `#f8fafc`
- Border: `#dde3ec`
- Strong border: `#c9d2df`
- Text: `#151922`
- Muted text: `#667085`
- Primary accent: `#2563eb`
- Strong accent: `#1d4ed8`
- Success: `#067647`
- Warning: `#9a3412`
- Danger: `#b42318`

## Typography
- Use system UI stack for extension reliability and fast loading.
- Headings: 14-16px, 700 weight.
- Labels and metadata: 12-13px.
- JSON and prompt text: monospace only where precision matters.

## Components
- Cards use 8px radius or less, 1px borders, and restrained shadows.
- Icon buttons use 32px stable square dimensions.
- Selects and textareas use visible focus states and enough contrast for long Chinese text.
- Chips are compact rounded tokens for confidence fields, modes, and quick edit intents.
- JSON editor uses dark code styling to distinguish raw structured data from normal UI text.

## Responsive Rules
- Below 420px, template controls stack and image preview height tightens.
- Above 980px, workspace becomes a two-column workbench.
- Sticky bottom command bar must never obscure text controls and should remain visually separate from content.

## Decisions Log
| Date | Decision | Rationale |
| --- | --- | --- |
| 2026-05-12 | Created professional workstation UI direction | The extension is a repeated-use creative tool, not a marketing page. |
| 2026-05-12 | Prompt / JSON output tabs | Reduces scroll and gives users a clearer editing mental model. |
| 2026-05-12 | Sticky edit command with quick intents | Makes style, scene, and element replacement feel like a direct command workflow. |

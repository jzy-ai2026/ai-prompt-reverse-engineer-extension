import { createAppError, isAppError } from "./errors";
import {
  createPromptPreviewText,
  createStructuredJsonText,
  normalizePromptDocument,
  type NormalizePromptDocumentOptions,
  type PromptFieldKey,
  type PromptSourceType,
  type SourceImage,
  type PromptDocument
} from "./promptDocument";
import type { PromptTemplate } from "./promptTemplates";

const CHAT_COMPLETIONS_PATH = "/v1/chat/completions";
const REQUEST_TIMEOUT_MS = 60_000;
const RETRY_DELAY_MS = 3_000;
const MAX_ATTEMPTS = 2;

export interface OpenAiGatewayConfig {
  apiBaseUrl: string;
  apiKey: string;
  model: string;
}

export type ApiTaskPhase =
  | "uploading"
  | "analyzing"
  | "editing"
  | "parsing"
  | "retrying"
  | "json_mode_fallback";

export interface ApiProgressEvent {
  phase: ApiTaskPhase;
  attempt?: number;
  message?: string;
}

export type VisionImageDetail = "low" | "high" | "auto";

export interface AnalyzeImageInput {
  imageUrl: string;
  sourcePageUrl?: string;
  sourceTitle?: string;
  sourceImageUrl?: string;
  sourceType?: Extract<PromptSourceType, "single" | "batch">;
  imageDetail?: VisionImageDetail;
  template?: PromptTemplate;
  signal?: AbortSignal;
  onProgress?: (event: ApiProgressEvent) => void;
}

export interface AnalyzeImageMixInput {
  images: Array<{
    imageUrl: string;
    sourceImageUrl: string;
    sourcePageUrl?: string;
    sourceTitle?: string;
  }>;
  imageDetail?: VisionImageDetail;
  template?: PromptTemplate;
  signal?: AbortSignal;
  onProgress?: (event: ApiProgressEvent) => void;
}

export interface EditVisualReference {
  imageUrl: string;
  sourceImageUrl?: string;
  label?: string;
  sourceTitle?: string;
}

export interface EditPromptInput {
  document: PromptDocument;
  instruction: string;
  template?: PromptTemplate;
  visualReferences?: EditVisualReference[];
  signal?: AbortSignal;
  onProgress?: (event: ApiProgressEvent) => void;
}

export interface PromptDocumentResult {
  document: PromptDocument;
  rawText: string;
  usedJsonMode: boolean;
}

export type AssistantPromptMode =
  | "auto"
  | "text-to-image"
  | "image-and-text"
  | "editing";

export type AssistantEngine =
  | "nano-banana-pro"
  | "midjourney-v8.1"
  | "gpt-image-2";

export type AssistantReferenceRole =
  | "identity"
  | "style"
  | "composition"
  | "scene"
  | "product"
  | "text"
  | "material";

export type AssistantAspectRatio = string;

export type AssistantResolution = "1K" | "2K" | "4K";

export type AssistantRenderQuality = "sd" | "hd";

export type GptImage2ReferenceMode =
  | "auto"
  | "full_reference"
  | "style_only"
  | "composition_only"
  | "color_lighting_only"
  | "layout_only";

export type GptImage2TaskMode = "draft" | "reference";

export type GptImage2LayoutType =
  | "auto"
  | "pure_visual"
  | "poster"
  | "ecommerce"
  | "social_cover"
  | "ui_mockup"
  | "game_visual";

export type GptImage2OptimizeStrength = "standard" | "enhanced";

export type GptImage2TextPolicy =
  | "none"
  | "preserve"
  | "enhance"
  | "generate";

export type GptImage2GameUseCase =
  | "none"
  | "ingame_screenshot"
  | "environment_concept"
  | "character_concept"
  | "boss_arena"
  | "asset_breakdown"
  | "ui_screenshot";

export type GptImage2GameGenre =
  | "auto"
  | "wuxia"
  | "fantasy"
  | "sci_fi"
  | "realistic"
  | "stylized";

export interface GptImage2PromptOptions {
  taskMode?: GptImage2TaskMode;
  referenceMode?: GptImage2ReferenceMode;
  targetAspectRatio?: "auto" | AssistantAspectRatio;
  layoutType?: GptImage2LayoutType;
  optimizeStrength?: GptImage2OptimizeStrength;
  textPolicy?: GptImage2TextPolicy;
  exactText?: string;
  seed?: number;
  gameModeEnabled?: boolean;
  gameUseCase?: GptImage2GameUseCase;
  gameGenre?: GptImage2GameGenre;
}

export interface GptImage2ReferenceDebugItem {
  label: string;
  role: AssistantReferenceRole;
  sourceTitle?: string;
}

export interface GptImage2DebugInfo {
  input: {
    task_mode?: GptImage2TaskMode;
    reference_mode: GptImage2ReferenceMode;
    layout_type?: GptImage2LayoutType;
    optimize_strength?: GptImage2OptimizeStrength;
    text_policy?: GptImage2TextPolicy;
    target_aspect_ratio: string;
    aspect_ratio: string;
    direction: string;
    has_exact_text: boolean;
    subject_image_count: number;
    reference_image_count: number;
    format_warnings: string[];
    game_mode_enabled?: boolean;
    game_use_case?: GptImage2GameUseCase;
    game_genre?: GptImage2GameGenre;
    game_prompt_guidance?: string[];
    audit_warnings?: string[];
    seed?: number;
    model?: string;
  };
  image_mapping: {
    subject_images: GptImage2ReferenceDebugItem[];
    reference_images: GptImage2ReferenceDebugItem[];
    style_images: GptImage2ReferenceDebugItem[];
    composition_images: GptImage2ReferenceDebugItem[];
    color_lighting_images: GptImage2ReferenceDebugItem[];
    layout_images: GptImage2ReferenceDebugItem[];
  };
  parse_status: "parsed" | "fallback";
  raw_output: string;
  final_prompt: string;
  reference_summary: string;
  schema_result?: Record<string, unknown>;
  renderer_input?: Record<string, unknown>;
}

export type AssistantLightingRecipeKey =
  | "shadowShapes"
  | "shadowTargets"
  | "shadowEdges"
  | "contrast"
  | "shadowSources"
  | "fillLights";

export type AssistantCompositionRecipeKey =
  | "shotSize"
  | "cameraAngle"
  | "lens"
  | "structure"
  | "focalHierarchy"
  | "artistLogic";

export type AssistantColorRecipeKey =
  | "dominantPalette"
  | "shadowColor"
  | "highlightColor"
  | "accentColor"
  | "saturationContrast"
  | "grading";

export type AssistantRecipeSource = "auto" | "manual";

export type AssistantLightingSource = AssistantRecipeSource;

export interface AssistantLightingRecipe {
  name: string;
  promptText: string;
  negativePrompt?: string;
  presetId?: string;
  customText?: string;
  selectedKeywords?: Partial<Record<AssistantLightingRecipeKey, string[]>>;
}

export interface AssistantCompositionRecipe {
  name: string;
  promptText: string;
  negativePrompt?: string;
  presetId?: string;
  customText?: string;
  selectedKeywords?: Partial<Record<AssistantCompositionRecipeKey, string[]>>;
}

export interface AssistantColorRecipe {
  name: string;
  promptText: string;
  negativePrompt?: string;
  presetId?: string;
  customText?: string;
  selectedKeywords?: Partial<Record<AssistantColorRecipeKey, string[]>>;
}

export interface AssistantPromptReference {
  imageUrl?: string;
  sourceImageUrl?: string;
  sourcePageUrl?: string;
  sourceTitle?: string;
  label?: string;
  role: AssistantReferenceRole;
}

export interface AssistantReverseContext {
  sourceType: PromptSourceType;
  templateName?: string;
  promptText: string;
  negativePrompt?: string;
  structuredJson: string;
  fields: Partial<Record<PromptFieldKey, string>>;
}

export interface AssistantPromptInput {
  engine: AssistantEngine;
  mode: AssistantPromptMode;
  idea: string;
  references: AssistantPromptReference[];
  aspectRatio: AssistantAspectRatio;
  resolution: AssistantResolution;
  identityLock: boolean;
  reverseContext?: AssistantReverseContext;
  extraSpecs?: string;
  rawEnabled?: boolean;
  renderQuality?: AssistantRenderQuality;
  stylize?: number;
  chaos?: number;
  weird?: number;
  seed?: string;
  negativePrompt?: string;
  personalizationCode?: string;
  compositionRecipe?: AssistantCompositionRecipe;
  compositionRecipeEnabled?: boolean;
  autoCompositionEnabled?: boolean;
  compositionSource?: AssistantRecipeSource;
  lightingRecipe?: AssistantLightingRecipe;
  lightingRecipeEnabled?: boolean;
  autoLightingEnabled?: boolean;
  lightingSource?: AssistantLightingSource;
  colorRecipe?: AssistantColorRecipe;
  colorRecipeEnabled?: boolean;
  autoColorEnabled?: boolean;
  colorSource?: AssistantRecipeSource;
  gptImage2?: GptImage2PromptOptions;
  signal?: AbortSignal;
  onProgress?: (event: ApiProgressEvent) => void;
}

const ASSISTANT_ASPECT_RATIO_PATTERN = /^[1-9]\d{0,4}:[1-9]\d{0,4}$/;

export function normalizeAssistantAspectRatioText(value: string): string {
  return value
    .trim()
    .replace(/[０-９]/g, (char) =>
      String.fromCharCode(char.charCodeAt(0) - 0xfee0)
    )
    .replace(/[：／/×xX]/g, ":")
    .replace(/\s+/g, "");
}

export function normalizeAssistantAspectRatio(
  value: unknown
): AssistantAspectRatio | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = normalizeAssistantAspectRatioText(value);
  return ASSISTANT_ASPECT_RATIO_PATTERN.test(normalized)
    ? normalized
    : undefined;
}

export interface AssistantChineseCheck {
  backTranslation: string;
  checklist: string[];
  possibleIssues: string[];
}

export interface AssistantPromptResult {
  brief: string;
  finalPrompt: string;
  questions: string[];
  assumptions: string[];
  negativeConstraints: string[];
  chineseCheck?: AssistantChineseCheck;
  debugInfo?: GptImage2DebugInfo;
}

type ChatRole = "system" | "user" | "assistant";

interface TextContentPart {
  type: "text";
  text: string;
}

interface ImageContentPart {
  type: "image_url";
  image_url: {
    url: string;
    detail?: VisionImageDetail;
  };
}

type ChatContent = string | Array<TextContentPart | ImageContentPart>;

interface ChatMessage {
  role: ChatRole;
  content: ChatContent;
}

interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  response_format?: {
    type: "json_object";
  };
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
}

const ANALYZE_SYSTEM_PROMPT = [
  "你是一个专业的 AI 绘画和视频生成 Prompt 逆向工程助手。",
  "请从图片中提取可复用的视觉提示词结构。",
  "所有面向用户的文本必须使用简体中文，包括 prompt.*.description、raw_prompt_text、negative_prompt、metadata.model_suggestion。",
  "tags 可以保留行业常用英文短词，但必须优先提供中文描述；raw_prompt_text 必须是一段自然、可直接复制使用的中文提示词。",
  "必须只返回一个合法 JSON 对象，不要返回 Markdown、解释文字或代码块。",
  "JSON 必须符合 PromptDocument 结构：version、generated_at、source、prompt、raw_prompt_text、negative_prompt、metadata。",
  "prompt 字段必须包含 subject、style、lighting、color、composition、camera、mood、quality。",
  "每个 prompt 子字段至少包含 description 和 confidence；可根据需要补充 tags、palette、type、angle。",
  "如果无法确定某个字段，请给出合理描述并降低 confidence。"
].join("\n");

const EDIT_SYSTEM_PROMPT = [
  "你是一个 PromptDocument JSON 编辑器。",
  "用户会提供当前 PromptDocument 和自然语言修改指令。",
  "请根据指令修改对应字段，并返回修改后的完整 PromptDocument JSON。",
  "如果 PromptDocument 包含 template_output，请优先在 template_output 中保持原有模板结构并合理修改所有相关字段。",
  "所有面向用户的文本必须使用简体中文，包括 prompt.*.description、raw_prompt_text、negative_prompt、metadata.model_suggestion。",
  "如果原文中存在英文描述，请在不改变含义的前提下改写为自然中文；只有 tags 中的行业通用英文短词可以保留。",
  "必须保留原 JSON 的整体结构和未被要求修改的字段。",
  "必须同步更新 raw_prompt_text，使其反映修改后的完整提示词。",
  "必须只返回一个合法 JSON 对象，不要返回 Markdown、解释文字或代码块。"
].join("\n");

const NANO_BANANA_ASSISTANT_SYSTEM_PROMPT = [
  "You are a senior prompt director for Gemini 3 Pro Image, also known as Nano Banana Pro.",
  "Turn the user's Chinese or mixed-language idea into a complete professional English prompt.",
  "Write natural-language creative direction, not a tag pile.",
  "The final prompt must explicitly cover subject, action, location, style, composition, camera or lens, focus, lighting, color grading, materials, textures, mood, reference-image roles, text rendering when relevant, aspect ratio, and resolution.",
  "If the user asks for edits, write precise editing instructions: what changes, what stays locked, and what must not be redrawn.",
  "If references are provided, name them as Image 1, Image 2, etc. and state their role. Never blend identity, background, style, product, and text roles accidentally.",
  "If reverseContext is provided, treat it as a reverse-engineered visual brief. Preserve its style, composition, camera, lighting, color, material, mood, and negative constraints while still following the user's new idea.",
  "If the user idea is empty and reverseContext is provided, create a reusable prompt that continues the reverse-engineered style and composition instead of asking for more input.",
  "If identityLock is true, preserve bone structure, eye distance, jawline geometry, age, skin texture, and facial proportions. Include DO NOT beautify, DO NOT alter age, and DO NOT change facial proportions.",
  "For charts, infographics, UI, labels, or any factual visual, do not invent facts. Say that all data and exact text must come from user-provided input.",
  "Any visible text in the image must be quoted and include font style, position, size, and treatment.",
  "Return only a valid JSON object with this shape: brief, finalPrompt, chineseCheck, questions, assumptions, negativeConstraints.",
  "brief must be short Simplified Chinese. finalPrompt must be polished English.",
  "chineseCheck must be an object with backTranslation, checklist, and possibleIssues. All chineseCheck text must be Simplified Chinese.",
  "chineseCheck.backTranslation must faithfully explain the meaning of finalPrompt in Chinese without adding new visual details that are not in finalPrompt.",
  "chineseCheck.checklist must be short Chinese checks covering subject, reference-image roles, scene, style, camera or lens, identity lock, negative constraints, aspect ratio, and resolution when relevant.",
  "chineseCheck.possibleIssues must list Chinese ambiguities the user may need to confirm. Use an empty array when there are none.",
  "questions, assumptions, and negativeConstraints must be arrays of short Simplified Chinese strings."
].join("\n");

const MIDJOURNEY_V81_ASSISTANT_SYSTEM_PROMPT = [
  "You are a professional Midjourney V8.1 prompt engineer and commercial photographer.",
  "Turn the user's Chinese or mixed-language idea into one polished English Midjourney prompt.",
  "Follow the local Midjourney V8.1 guide: use full visual sentences, not a loose keyword pile.",
  "The prompt body must clearly cover subject, action or relationship, environment, era, composition, camera or lens, lighting, atmosphere, material or texture details, and visual target.",
  "If reverseContext is provided, translate it into concrete photography and film language. Use its style, composition, camera, lighting, color, mood, and material cues, but do not rigidly copy the original subject unless the user asks for it.",
  "If the user idea is empty and reverseContext is provided, create a reusable Midjourney prompt that continues the reverse-engineered visual style and composition.",
  "Translate vague Chinese words into concrete photography and film language. Examples: 好看的光 -> soft backlight, rim light, volumetric fog; 真实感 -> shot on Hasselblad X2D 100C, medium format photography, realistic material texture.",
  "V8.1 requires --v 8.1 at the end of the prompt. Parameters must appear only at the very end, after all descriptive text.",
  "Use --raw for realistic photography, film stills, AAA game screenshots, architecture, product photography, or complex literal scene control unless the user explicitly asks for a strongly stylized illustration.",
  "Use --hd for final high-detail output and --sd for exploration. Never combine --hd and --sd.",
  "Never output unsupported V8.1 parameters in finalPrompt: --q, --quality, --cref, --cw, --oref, --ow, --draft, or multi-prompt :: syntax.",
  "Do not mix --niji 7 with --v 8.1.",
  "Style references are allowed: use --sref URL --sw 100 unless the user asks for another style weight.",
  "Image prompts are allowed: public image URLs can appear at the beginning of finalPrompt and may use --iw 1.",
  "Never put a data URL, upload:// URL, or clipboard:// URL into finalPrompt. Use a clear placeholder such as <image-1-url> and explain in Chinese that the user must upload the image to Midjourney or Discord to get a usable URL.",
  "If the user asks for character or product identity consistency, explain in Chinese that V8.1 does not support Character Reference or Omni Reference; use an image prompt, consistent text description, and fixed seed as weaker alternatives.",
  "If visible English text is required, put the exact text in double quotation marks. Do not promise stable Chinese text rendering in V8.1.",
  "Return only a valid JSON object with this shape: brief, finalPrompt, chineseCheck, questions, assumptions, negativeConstraints.",
  "brief must be short Simplified Chinese. finalPrompt must be a copy-ready English Midjourney prompt, no Markdown and no code fence.",
  "chineseCheck must be an object with backTranslation, checklist, and possibleIssues. All chineseCheck text must be Simplified Chinese.",
  "chineseCheck.backTranslation must explain the finalPrompt faithfully in Chinese and include the meaning of key parameters.",
  "chineseCheck.checklist must include short checks for subject, scene, camera/composition, lighting, materials/style, aspect ratio, Raw, SD/HD, Stylize, references, and negative prompt when relevant.",
  "questions, assumptions, and negativeConstraints must be arrays of short Simplified Chinese strings."
].join("\n");

const GPT_IMAGE_2_REFERENCE_OPTIMIZER_SYSTEM_PROMPT = [
  "你是一个专业的图像参考提示词优化器。",
  "你的任务是根据用户提供的图像和文字需求，生成一段新的、完整的、适合 GPT-Image-2 图生图使用的中文提示词。",
  "你不是图像编辑器，不需要修改原图。你需要分析 subject_image 和 reference_image 的作用，并结合 user_prompt 生成新的出图提示词。",
  "",
  "输入说明：",
  "1. subject_image 是可选主体图。如果用户提供 subject_image，应以 subject_image 中的主体作为最终画面核心，保留其外观、结构、颜色、材质、比例和关键识别特征。",
  "2. reference_image 是必填参考图。reference_image 用于提供风格、构图、色彩、光影、版式、文字排版、氛围和视觉质感。",
  "3. 如果没有 subject_image，则 reference_image 作为单图参考图使用。",
  "4. 如果有 subject_image，则 subject_image 决定核心主体，reference_image 决定视觉参考方向。",
  "5. user_prompt 决定最终生成主题和用途，不允许被 reference_image 中的主体覆盖。",
  "",
  "核心原则：",
  "1. 用户需求决定最终生成内容。",
  "2. 如果存在 subject_image，必须优先保留 subject_image 中主体的关键识别特征。",
  "3. reference_image 不仅可以提供风格，也可以在综合参考时提供人物出镜方式、场景氛围、道具关系、图文关系和整体画面组织方式。",
  "4. 不要让 reference_image 中的产品或主体替换 subject_image 的核心主体。",
  "5. 必须根据 reference_mode 控制参考范围。",
  "6. 如果 target_aspect_ratio 不是 auto，最终提示词必须明确写出目标画幅比例，并让构图适配该比例。",
  "7. 如果 target_aspect_ratio 是 auto，不主动强制画幅比例，应根据用户需求、参考图和最终用途自然生成。",
  "8. 多图冲突时按用户明确需求、主体图、版式图、构图图、色彩光影图、风格图的优先级处理。",
  "9. 不要过度展开细节，不要为了完整而堆砌描述。",
  "10. 只保留对最终生成真正关键的元素，包括主体、动作、参考关系、版式文字和必要的视觉方向。",
  "11. 输出应尽量简洁、自然、可执行，避免空泛形容词堆砌，也避免模块化施工说明书式输出。",
  "",
  "reference_mode 规则：",
  "- auto：根据 user_prompt、subject_image 和 reference_image 自动选择最合适的参考范围。",
  "- full_reference：综合参考 reference_image 的整体画面组织方式和视觉语言，包括风格、构图、色彩、光影、氛围、版式、文字层级和整体视觉气质。",
  "- style_only：只参考 reference_image 的整体风格、视觉气质、材质感、摄影感、插画感、商业感和氛围。",
  "- composition_only：只参考 reference_image 的构图结构、主体位置、画面重心、留白方向、视角、主体占比和必要主体关系。",
  "- color_lighting_only：只参考 reference_image 的色彩系统、冷暖关系、明暗关系、光影氛围和影调方向。",
  "- layout_only：只参考 reference_image 的版式结构、图文关系、标题位置、副标题位置、信息区位置、品牌区位置、文字大小层级和版面节奏。",
  "",
  "文字处理规则：",
  "1. 如果 reference_image 中存在明显标题区、卖点区、信息栏、品牌区、标签区等文字结构，应继承其版式层级、排版位置、信息组织方式和视觉表达风格。",
  "2. 文案内容不应机械照搬 reference_image 中原有内容，而应根据当前主题进行改写。",
  "3. 产品本体文字属于产品识别信息，应优先保留。",
  "4. 如果 user_prompt 中提供了明确文案内容，则以 user_prompt 为准。",
  "5. 如果 reference_image 中没有明显文字结构，且 user_prompt 也没有要求文字，应写清楚：画面中不主动添加额外可读文字。",
  "",
  "人物参与展示规则：双图模式下，如果 reference_image 中存在人物、模特、手部或明显的人物参与关系，且 reference_mode 是 auto 或 full_reference，应继承人物参与展示关系，但不复制具体身份、面部特征或品牌代言属性。可以保留性别、大致年龄段、人数、整体气质和展示角色，但不能把参考图人物的具体身份替换为最终主体。",
  "",
  "单图和多图规则：只有一张 reference_image 时，不要声明独立 subject_image；该图同时作为视觉参考和主题参考，但最终内容仍由 user_prompt 决定。有 subject_image 和 reference_image 时，subject_image 决定核心主体，reference_image 只决定视觉方向。",
  "",
  "输出要求：",
  "请输出两部分内容：",
  "optimized_prompt:",
  "输出为自然段式中文提示词，必须使用 3 到 4 个自然段，每段 1 到 3 句话。",
  "reference_summary:",
  "简要总结 reference_image 的视觉特征，包括风格、构图、色彩、光影、氛围、版式和文字情况。",
  "",
  "绝对禁止：",
  "- 禁止使用【】标题。",
  "- 禁止使用项目符号、编号列表、清单式结构。",
  "- 禁止使用配置文件式或施工说明书式写法。",
  "- 禁止输出超过 4 段。",
  "- 禁止输出“保留参考图原有文字内容”“直接沿用参考图文字”等机械照搬文案的表达。",
  "- 禁止输出“不要主动生成文案”“如需要文字”等回避文字处理的表达。"
].join("\n");

const GPT_IMAGE_2_SCHEMA_PARSER_SYSTEM_PROMPT = [
  "你是 GPT-Image-2 提示词 Schema 解析器。",
  "你的任务是把用户的图像需求解析成结构化 JSON，不要直接生成最终提示词。",
  "只输出 JSON，不要解释，不要 Markdown，不要代码块。",
  "",
  "解析原则：",
  "1. 保留用户核心意图，不要把明确的人名、品牌名、产品名、地点名、游戏名、平台名泛化。",
  "2. aspect_ratio、direction、layout_type、optimize_strength、text_policy 必须使用输入 payload 中的值，不得自行改写。",
  "3. 标准模式以稳定、清晰、商业可控为优先；增强模式以创意、视觉冲击和设计感为优先，但仍不能改变用户核心主题。",
  "4. text_policy=none 时，text_requirements 必须为空数组，layout_plan、typography_plan、copy_strategy、information_hierarchy 不得诱导标题区、卖点栏、品牌区或信息栏。",
  "5. text_policy=preserve 时，exact_text 非空必须逐字保留到 text_requirements，不得改写、翻译、删减、补标点或改大小写。",
  "6. text_policy=generate 且 optimize_strength=standard 时，只生成必要、清晰、可控的核心文字。",
  "7. text_policy=generate 且 optimize_strength=enhanced 时，text_requirements 是核心文案锚点，不是唯一文字限制。",
  "8. 如果 game_context 非空，必须把游戏用途解析进 image_type、subject、environment、composition、style 或 ui_layout，但不要硬加无关 HUD。",
  "",
  "输出 JSON 字段必须完整：",
  "{",
  '  "image_type": "",',
  '  "subject": "",',
  '  "action": "",',
  '  "environment": "",',
  '  "composition": "",',
  '  "style": "",',
  '  "lighting_color": "",',
  '  "visual_focus": [],',
  '  "layout_plan": "",',
  '  "typography_plan": "",',
  '  "copy_strategy": "",',
  '  "information_hierarchy": "",',
  '  "text_requirements": [],',
  '  "constraints": [],',
  '  "named_entities": [],',
  '  "ui_layout": "",',
  '  "game_context": "",',
  '  "aspect_ratio": "",',
  '  "direction": "",',
  '  "layout_type": "",',
  '  "optimize_strength": "",',
  '  "text_policy": ""',
  "}"
].join("\n");

const GPT_IMAGE_2_DRAFT_PROMPT_MODULES = [
  "图像类型",
  "主体",
  "场景背景",
  "构图与风格",
  "文字要求",
  "限制条件"
] as const;

const GPT_IMAGE_2_DRAFT_PROMPT_RENDERER_SYSTEM_PROMPT = [
  "你是 GPT-Image-2 中间层提示词渲染器。",
  "你的任务是根据输入 JSON schema，生成适合 GPT-Image-2 无图生图使用的格式化中文提示词。",
  "只输出最终提示词，不要解释，不要 Markdown，不要 JSON，不要代码块。",
  "",
  "必须严格输出以下六个模块，模块名和顺序不得改变，不得新增模块：",
  "【图像类型】",
  "【主体】",
  "【场景背景】",
  "【构图与风格】",
  "【文字要求】",
  "【限制条件】",
  "",
  "模块规则：",
  "1. 【图像类型】写清图像类型、aspect_ratio 和 direction。",
  "2. 【主体】整合 subject 和 action，说明主体是谁、是什么、在做什么、如何呈现。",
  "3. 【场景背景】整合 environment 和 ui_layout，说明背景空间、场景氛围和必要环境元素。",
  "4. 【构图与风格】整合 composition、style、lighting_color、visual_focus、layout_plan、information_hierarchy 和 game_context 中的镜头/玩法空间信息。",
  "5. 【文字要求】必须单独处理 text_requirements、typography_plan 和 copy_strategy。",
  "6. 【限制条件】整合 constraints，最多 2 句话，强调主题准确、画幅方向、文案限制和必要禁止项。",
  "",
  "硬性规则：",
  "1. 必须严格使用 schema 中的 aspect_ratio 和 direction，不得出现相反方向词。",
  "2. 必须保留 schema 中的 named_entities。",
  "3. 标准模式完整覆盖 schema 字段，使提示词结构清晰、信息完整、商业可控。",
  "4. 增强模式不要机械复述每个字段，优先提炼最能决定画面美学和设计感的信息，但六个模块仍必须齐全。",
  "5. text_policy=none 时，【文字要求】写：无指定文字，画面中不要主动添加标题、卖点、品牌区、信息栏或其他可读文字。",
  "6. text_policy=preserve 时，text_requirements 必须逐字逐符号原样输出，并要求不得改写、翻译、删减或补标点。",
  "7. text_policy=generate 且 optimize_strength=standard 时，【文字要求】必须使用“画面必须且只能显示以下文字”。",
  "8. text_policy=generate 且 optimize_strength=enhanced 时，【文字要求】使用“画面核心文案可包含”，允许模型根据整体美学组织辅助文字。",
  "9. 如果 game_context 非空，把游戏用途合并进现有六模块；不要新增【游戏用途】段。",
  "10. 除非用户明确要求 HUD 或 game_context 是 UI 截图，不要自动加入 HUD、血条、小地图或技能栏。"
].join("\n");

const MIDJOURNEY_V81_UNSUPPORTED_PARAMETER_PATTERN =
  /\s--(?:q|quality|cref|cw|oref|ow|draft|niji)\b(?:\s+(?!--)\S+)*/gi;
const MIDJOURNEY_PARAMETER_PATTERNS = [
  /\s--ar(?:\s+(?!--)\S+)*/gi,
  /\s--aspect(?:\s+(?!--)\S+)*/gi,
  /\s--v(?:ersion)?\s+(?!--)\S+(?:\s+(?!--)\S+)*/gi,
  /\s--raw\b/gi,
  /\s--hd\b/gi,
  /\s--sd\b/gi,
  /\s--s(?:tylize)?\s+(?!--)\S+/gi,
  /\s--c(?:haos)?\s+(?!--)\S+/gi,
  /\s--w(?:eird)?\s+(?!--)\S+/gi,
  /\s--seed\s+(?!--)\S+/gi,
  /\s--p(?:rofile)?(?:\s+(?!--)\S+)*/gi,
  /\s--iw\s+(?!--)\S+/gi,
  /\s--sref(?:\s+(?!--)\S+)*/gi,
  /\s--sw\s+(?!--)\S+/gi,
  /\s--no\s+[\s\S]*?(?=\s--[a-z]|\s*$)/gi
];

const GPT_IMAGE_2_REFERENCE_MODES: GptImage2ReferenceMode[] = [
  "auto",
  "full_reference",
  "style_only",
  "composition_only",
  "color_lighting_only",
  "layout_only"
];

const GPT_IMAGE_2_TASK_MODES: GptImage2TaskMode[] = ["draft", "reference"];
const GPT_IMAGE_2_LAYOUT_TYPES: GptImage2LayoutType[] = [
  "auto",
  "pure_visual",
  "poster",
  "ecommerce",
  "social_cover",
  "ui_mockup",
  "game_visual"
];
const GPT_IMAGE_2_OPTIMIZE_STRENGTHS: GptImage2OptimizeStrength[] = [
  "standard",
  "enhanced"
];
const GPT_IMAGE_2_TEXT_POLICIES: GptImage2TextPolicy[] = [
  "none",
  "preserve",
  "enhance",
  "generate"
];
const GPT_IMAGE_2_GAME_USE_CASES: GptImage2GameUseCase[] = [
  "none",
  "ingame_screenshot",
  "environment_concept",
  "character_concept",
  "boss_arena",
  "asset_breakdown",
  "ui_screenshot"
];
const GPT_IMAGE_2_GAME_GENRES: GptImage2GameGenre[] = [
  "auto",
  "wuxia",
  "fantasy",
  "sci_fi",
  "realistic",
  "stylized"
];

const REVERSE_CONTEXT_FIELD_KEYS: PromptFieldKey[] = [
  "subject",
  "style",
  "lighting",
  "color",
  "composition",
  "camera",
  "mood",
  "quality"
];

export function createAssistantReverseContextFromDocument(
  document: PromptDocument
): AssistantReverseContext {
  const fields = REVERSE_CONTEXT_FIELD_KEYS.reduce<
    Partial<Record<PromptFieldKey, string>>
  >((output, key) => {
    const field = document.prompt[key];
    const description = field?.description?.trim();

    if (description && field.confidence > 0 && isMeaningfulReverseContextText(description)) {
      output[key] = description;
    }

    return output;
  }, {});

  return {
    sourceType: document.source.type,
    templateName: document.template?.name,
    promptText: createPromptPreviewText(document),
    negativePrompt: document.negative_prompt.trim() || undefined,
    structuredJson: createStructuredJsonText(document),
    fields
  };
}

function isMeaningfulReverseContextText(value: string): boolean {
  const normalized = value.replace(/\s+/g, "").toLowerCase();

  if (!normalized) {
    return false;
  }

  return !(
    normalized.startsWith("未识别") ||
    normalized === "unknown" ||
    normalized === "n/a" ||
    normalized === "na" ||
    normalized === "none" ||
    normalized === "高质量，细节丰富".replace(/\s+/g, "").toLowerCase()
  );
}

export async function analyzeImagePrompt(
  config: OpenAiGatewayConfig,
  input: AnalyzeImageInput
): Promise<PromptDocumentResult> {
  validateConfig(config);
  input.onProgress?.({ phase: "uploading", message: "Preparing image payload" });
  const sourceType = input.sourceType ?? "single";

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: createAnalyzeSystemPrompt(input.template, ANALYZE_SYSTEM_PROMPT)
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: [
            "请反推这张图片的生成 Prompt，并输出 PromptDocument JSON。",
            `来源页面：${input.sourcePageUrl ?? "unknown"}`,
            `页面标题：${input.sourceTitle ?? "unknown"}`,
            `source.type 使用 ${sourceType}。`,
            "source.images[0].id 使用 img_001。",
            "source.images[0].source_url 使用输入图片原始 URL 或 unknown。",
            "不要把 base64 图片内容写入 JSON。",
            "请用当前模板要求输出结果。"
          ].join("\n")
        },
        {
          type: "image_url",
          image_url: {
            url: input.imageUrl,
            detail: input.imageDetail ?? "high"
          }
        }
      ]
    }
  ];

  input.onProgress?.({ phase: "analyzing", message: "Calling vision model" });

  const result = await requestPromptDocument(config, messages, {
    signal: input.signal,
    onProgress: input.onProgress,
    phase: "analyzing",
    template: input.template,
    normalizeOptions: {
      sourceType,
      sourceImageUrl: input.sourceImageUrl ?? input.imageUrl,
      sourcePageUrl: input.sourcePageUrl
    }
  });

  return result;
}

export async function analyzeImageStyleCommonPrompt(
  config: OpenAiGatewayConfig,
  input: AnalyzeImageMixInput
): Promise<PromptDocumentResult> {
  validateConfig(config);

  if (input.images.length < 2) {
    throw createAppError(
      "image_not_found",
      "多图同风格分析至少需要 2 张参考图。"
    );
  }

  const textParts = [
    "请对这些参考图做同一种视觉风格的最大公约数分析，并输出当前模板要求的合法 JSON。",
    "只提取多张图共享的美术风格、光影、色彩、构图、质感和人脸/造型风格化规律。",
    "不要把多张图的主体、人物身份、场景叙事或道具功能混合成一个新画面。",
    "输出保持精简：每个 JSON 字段用 1 句具体中文描述，不要写分析过程、不要列长段落。",
    "source.type 使用 style_common。",
    "source.images 按输入顺序保留每张图片，id 使用 img_001、img_002 这样的格式。",
    "不要把 base64 图片内容写入 JSON。",
    "请用简体中文输出共享风格分析，不要输出英文 Prompt。",
    "",
    "参考图来源：",
    ...input.images.map((image, index) =>
      [
        `${index + 1}. ${image.sourceTitle ?? "unknown"}`,
        `   图片：${image.sourceImageUrl || "unknown"}`,
        `   页面：${image.sourcePageUrl ?? "unknown"}`
      ].join("\n")
    )
  ];

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: createAnalyzeSystemPrompt(input.template, ANALYZE_SYSTEM_PROMPT)
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: textParts.join("\n")
        },
        ...input.images.map((image) => ({
          type: "image_url" as const,
          image_url: {
            url: image.imageUrl,
            detail: input.imageDetail ?? "low"
          }
        }))
      ]
    }
  ];

  input.onProgress?.({ phase: "analyzing", message: "Calling vision model" });
  const sourceImages = createMixSourceImages(input);

  const result = await requestPromptDocument(config, messages, {
    signal: input.signal,
    onProgress: input.onProgress,
    phase: "analyzing",
    template: input.template,
    normalizeOptions: {
      sourceType: "style_common",
      sourceImages
    }
  });

  return result;
}

function createMixSourceImages(input: AnalyzeImageMixInput): SourceImage[] {
  return input.images.map((image, index) => ({
    id: `img_${String(index + 1).padStart(3, "0")}`,
    source_url: image.sourceImageUrl,
    page_url: image.sourcePageUrl
  }));
}

export async function editPromptDocument(
  config: OpenAiGatewayConfig,
  input: EditPromptInput
): Promise<PromptDocumentResult> {
  validateConfig(config);

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: createEditSystemPrompt(input.template)
    },
    {
      role: "user",
      content: createEditUserContent(input)
    }
  ];

  input.onProgress?.({ phase: "editing", message: "Calling edit model" });

  return requestPromptDocument(config, messages, {
    signal: input.signal,
    onProgress: input.onProgress,
    phase: "editing",
    template: input.template ?? readTemplateFromDocument(input.document),
    normalizeOptions: {
      sourceType: input.document.source.type,
      sourceImages: input.document.source.images
    }
  });
}

export async function generateAssistantPromptWithGateway(
  config: OpenAiGatewayConfig,
  input: AssistantPromptInput
): Promise<AssistantPromptResult> {
  validateConfig(config);

  if (input.engine === "gpt-image-2") {
    return generateGptImage2AssistantPrompt(config, input);
  }

  if (!input.idea.trim() && !input.reverseContext) {
    throw createAppError(
      "missing_config",
      "Please describe what you want to create or attach a reverse JSON context."
    );
  }

  input.onProgress?.({
    phase: "analyzing",
    message:
      input.engine === "midjourney-v8.1"
        ? "Calling Midjourney V8.1 prompt assistant"
        : "Calling Nano Banana Pro prompt assistant"
  });

  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        input.engine === "midjourney-v8.1"
          ? MIDJOURNEY_V81_ASSISTANT_SYSTEM_PROMPT
          : NANO_BANANA_ASSISTANT_SYSTEM_PROMPT
    },
    {
      role: "user",
      content:
        input.engine === "midjourney-v8.1"
          ? createMidjourneyAssistantUserContent(input)
          : createNanoBananaAssistantUserContent(input)
    }
  ];

  const result = await requestAssistantPromptResult(config, messages, {
    signal: input.signal,
    onProgress: input.onProgress
  });

  return input.engine === "midjourney-v8.1"
    ? normalizeMidjourneyAssistantResult(result, input)
    : normalizeNanoBananaAssistantResult(result, input);
}

async function generateGptImage2AssistantPrompt(
  config: OpenAiGatewayConfig,
  input: AssistantPromptInput
): Promise<AssistantPromptResult> {
  if (!input.idea.trim()) {
    throw createAppError(
      "missing_config",
      "Please describe what you want GPT-Image-2 to generate."
    );
  }

  const control = createGptImage2ControlSettings(input);

  if (control.taskMode === "draft") {
    return generateGptImage2DraftPrompt(config, input, control);
  }

  const mapping = createGptImage2ReferenceMapping(input);

  if (!mapping.referenceImages.length) {
    throw createAppError(
      "image_not_found",
      "GPT-Image-2 图生图提示词优化至少需要一张参考图。"
    );
  }

  input.onProgress?.({
    phase: "analyzing",
    message: "Calling GPT-Image-2 reference prompt optimizer"
  });

  const response = await fetchChatCompletion(
    config,
    createRequestBody(
      config,
      [
        {
          role: "system",
          content: GPT_IMAGE_2_REFERENCE_OPTIMIZER_SYSTEM_PROMPT
        },
        {
          role: "user",
          content: createGptImage2ReferenceUserContent(input, mapping)
        }
      ],
      false
    ),
    {
      signal: input.signal,
      onProgress: input.onProgress,
      phase: "analyzing"
    }
  );
  const rawOutput = extractAssistantText(response);
  const parsed = parseGptImage2OptimizerOutput(rawOutput);
  const auditWarnings = createGptImage2PromptAuditWarnings({
    input,
    prompt: parsed.optimizedPrompt,
    aspectRatio: mapping.aspectRatio,
    control,
    mapping
  });
  const repairedPrompt = applyGptImage2LightRepair({
    prompt: parsed.optimizedPrompt,
    input,
    aspectRatio: mapping.aspectRatio,
    control,
    auditWarnings
  });
  const finalParsed =
    repairedPrompt === parsed.optimizedPrompt
      ? parsed
      : { ...parsed, optimizedPrompt: repairedPrompt };
  const formatWarnings = [
    ...createGptImage2FormatWarnings(mapping, finalParsed),
    ...auditWarnings.map((warning) => `约束审计：${warning}`)
  ];
  const debugInfo: GptImage2DebugInfo = {
    input: {
      ...createGptImage2DebugInput(input, mapping.aspectRatio, control),
      reference_mode: mapping.referenceMode,
      target_aspect_ratio: mapping.aspectRatio,
      aspect_ratio: mapping.aspectRatio,
      direction: getGptImage2Direction(mapping.aspectRatio),
      has_exact_text: Boolean(input.gptImage2?.exactText?.trim()),
      subject_image_count: mapping.subjectImages.length,
      reference_image_count: mapping.referenceImages.length,
      format_warnings: formatWarnings,
      ...(auditWarnings.length ? { audit_warnings: auditWarnings } : {}),
      ...(mapping.seed ? { seed: mapping.seed } : {}),
      model: config.model
    },
    image_mapping: createGptImage2DebugMapping(mapping),
    parse_status: finalParsed.parseStatus,
    raw_output: rawOutput,
    final_prompt: finalParsed.optimizedPrompt,
    reference_summary: finalParsed.referenceSummary
  };

  return {
    brief: "GPT-Image-2 图生图提示词已优化",
    finalPrompt: finalParsed.optimizedPrompt,
    questions: createGptImage2Questions(input, mapping, formatWarnings),
    assumptions: createGptImage2Assumptions(mapping),
    negativeConstraints: createGptImage2NegativeConstraints(mapping),
    chineseCheck: {
      backTranslation:
        finalParsed.referenceSummary ||
        "模型未单独返回 reference_summary，已将完整输出作为提示词兜底。",
      checklist: createGptImage2Checklist(mapping, finalParsed, formatWarnings),
      possibleIssues: createGptImage2Questions(
        input,
        mapping,
        formatWarnings
      )
    },
    debugInfo
  };
}

async function generateGptImage2DraftPrompt(
  config: OpenAiGatewayConfig,
  input: AssistantPromptInput,
  control: GptImage2ControlSettings
): Promise<AssistantPromptResult> {
  const aspectRatio =
    readGptImage2TargetAspectRatio(
      input.gptImage2?.targetAspectRatio,
      normalizeAssistantAspectRatio(input.aspectRatio) ?? "16:9"
    ) || "16:9";
  const payload = createGptImage2DraftPayload(input, control, aspectRatio);

  input.onProgress?.({
    phase: "analyzing",
    message: "Parsing GPT-Image-2 draft schema"
  });

  const schemaResponse = await fetchChatCompletion(
    config,
    createRequestBody(
      config,
      [
        {
          role: "system",
          content: GPT_IMAGE_2_SCHEMA_PARSER_SYSTEM_PROMPT
        },
        {
          role: "user",
          content: JSON.stringify(payload, null, 2)
        }
      ],
      false
    ),
    {
      signal: input.signal,
      onProgress: input.onProgress,
      phase: "analyzing"
    }
  );
  const rawSchemaOutput = extractAssistantText(schemaResponse);
  const parsedSchema = parseGptImage2PromptSchema(rawSchemaOutput);
  const normalizedSchema = normalizeGptImage2PromptSchema(
    parsedSchema,
    input,
    control,
    aspectRatio
  );

  input.onProgress?.({
    phase: "editing",
    message: "Rendering GPT-Image-2 draft prompt"
  });

  const rendererResponse = await fetchChatCompletion(
    config,
    createRequestBody(
      config,
      [
        {
          role: "system",
          content: GPT_IMAGE_2_DRAFT_PROMPT_RENDERER_SYSTEM_PROMPT
        },
        {
          role: "user",
          content: JSON.stringify(normalizedSchema, null, 2)
        }
      ],
      false
    ),
    {
      signal: input.signal,
      onProgress: input.onProgress,
      phase: "editing"
    }
  );
  const rawRendererOutput = extractAssistantText(rendererResponse);
  const renderedPrompt = normalizeGptImage2OptimizedPrompt(
    stripMarkdownFence(rawRendererOutput)
  );
  const auditWarnings = createGptImage2DraftPromptAuditWarnings({
    input,
    prompt: renderedPrompt,
    aspectRatio,
    control
  });
  const finalPrompt = applyGptImage2DraftLightRepair({
    prompt: renderedPrompt,
    input,
    aspectRatio,
    control,
    auditWarnings
  });
  const finalWarnings = auditWarnings.map((warning) => `约束审计：${warning}`);
  const debugInfo: GptImage2DebugInfo = {
    input: {
      ...createGptImage2DebugInput(input, aspectRatio, control),
      reference_mode: "auto",
      target_aspect_ratio: aspectRatio,
      aspect_ratio: aspectRatio,
      direction: getGptImage2Direction(aspectRatio),
      has_exact_text: Boolean(input.gptImage2?.exactText?.trim()),
      subject_image_count: 0,
      reference_image_count: 0,
      format_warnings: finalWarnings,
      ...(finalWarnings.length ? { audit_warnings: auditWarnings } : {}),
      model: config.model
    },
    image_mapping: createEmptyGptImage2DebugMapping(),
    parse_status: parsedSchema.parseStatus,
    raw_output: [rawSchemaOutput, rawRendererOutput].join("\n\n--- renderer ---\n\n"),
    final_prompt: finalPrompt,
    reference_summary: "无图 Prompt 草案由结构化 schema 渲染生成。",
    schema_result: normalizedSchema as unknown as Record<string, unknown>,
    renderer_input: normalizedSchema as unknown as Record<string, unknown>
  };

  return {
    brief: "GPT-Image-2 无图 Prompt 草案已生成",
    finalPrompt,
    questions: finalWarnings,
    assumptions: [
      "GPT-Image-2 助手只生成提示词草案，不直接生成图片。",
      "草案按 schema parser -> normalize -> renderer 流程生成，并在输出后做约束审计。",
      control.gameModeEnabled
        ? "游戏用途增强仅影响提示词文本，不会自动添加真实 HUD 或触发图片生成。"
        : ""
    ].filter(Boolean),
    negativeConstraints: createGptImage2DraftNegativeConstraints(control),
    chineseCheck: {
      backTranslation: "无图草案已按【图像类型】【主体】【场景背景】【构图与风格】【文字要求】【限制条件】六模块渲染。",
      checklist: createGptImage2DraftChecklist(normalizedSchema, finalWarnings),
      possibleIssues: finalWarnings
    },
    debugInfo
  };
}

interface GptImage2MappedReference extends AssistantPromptReference {
  imageUrl: string;
  label: string;
  index: number;
}

interface GptImage2ReferenceMapping {
  aspectRatio: string;
  aspect_ratio: string;
  direction: string;
  referenceMode: GptImage2ReferenceMode;
  seed: number;
  subjectImages: GptImage2MappedReference[];
  referenceImages: GptImage2MappedReference[];
  styleImages: GptImage2MappedReference[];
  compositionImages: GptImage2MappedReference[];
  colorLightingImages: GptImage2MappedReference[];
  layoutImages: GptImage2MappedReference[];
  usedSingleReferenceMode: boolean;
  usedFallbackReferenceImage: boolean;
}

interface GptImage2ParsedOptimizerOutput {
  optimizedPrompt: string;
  referenceSummary: string;
  parseStatus: "parsed" | "fallback";
}

interface GptImage2PromptSchema {
  image_type: string;
  subject: string;
  action: string;
  environment: string;
  composition: string;
  style: string;
  lighting_color: string;
  visual_focus: string[];
  layout_plan: string;
  typography_plan: string;
  copy_strategy: string;
  information_hierarchy: string;
  text_requirements: string[];
  constraints: string[];
  named_entities: string[];
  ui_layout: string;
  game_context: string;
  aspect_ratio: string;
  direction: string;
  layout_type: GptImage2LayoutType;
  optimize_strength: GptImage2OptimizeStrength;
  text_policy: GptImage2TextPolicy;
}

interface GptImage2ControlSettings {
  taskMode: GptImage2TaskMode;
  layoutType: GptImage2LayoutType;
  optimizeStrength: GptImage2OptimizeStrength;
  textPolicy: GptImage2TextPolicy;
  gameModeEnabled: boolean;
  gameUseCase: GptImage2GameUseCase;
  gameGenre: GptImage2GameGenre;
  gameGuidance: string[];
}

function createGptImage2ReferenceMapping(
  input: AssistantPromptInput
): GptImage2ReferenceMapping {
  const options = input.gptImage2 ?? {};
  const fallbackAspectRatio =
    normalizeAssistantAspectRatio(input.aspectRatio) ?? "16:9";
  const aspectRatio = readGptImage2TargetAspectRatio(
    options.targetAspectRatio,
    fallbackAspectRatio
  );
  const references = input.references
    .map((reference, index): GptImage2MappedReference | undefined => {
      const imageUrl = reference.imageUrl?.trim();

      if (!imageUrl) {
        return undefined;
      }

      return {
        ...reference,
        imageUrl,
        label: reference.label?.trim() || `图片 ${index + 1}`,
        index
      };
    })
    .filter((reference): reference is GptImage2MappedReference =>
      Boolean(reference)
    );

  const subjectCandidates = references.filter((reference) =>
    ["identity", "product"].includes(reference.role)
  );
  const visualReferences = references.filter(
    (reference) => !["identity", "product"].includes(reference.role)
  );
  let subjectImages: GptImage2MappedReference[] = [];
  let referenceImages: GptImage2MappedReference[] = [];
  let usedSingleReferenceMode = false;
  let usedFallbackReferenceImage = false;

  if (references.length === 1) {
    referenceImages = references;
    usedSingleReferenceMode = true;
  } else if (subjectCandidates.length && visualReferences.length) {
    subjectImages = subjectCandidates;
    referenceImages = visualReferences;
  } else if (subjectCandidates.length > 1) {
    subjectImages = subjectCandidates.slice(0, -1);
    referenceImages = subjectCandidates.slice(-1);
    usedFallbackReferenceImage = true;
  } else if (subjectCandidates.length === 1) {
    referenceImages = subjectCandidates;
    usedSingleReferenceMode = true;
  } else {
    referenceImages = references;
  }

  const seed =
    typeof options.seed === "number" &&
    Number.isInteger(options.seed) &&
    options.seed > 0
      ? options.seed
      : 0;

  return {
    aspectRatio,
    aspect_ratio: aspectRatio,
    direction: getGptImage2Direction(aspectRatio),
    referenceMode: readGptImage2ReferenceMode(options.referenceMode, "auto"),
    seed,
    subjectImages,
    referenceImages,
    styleImages: referenceImages.filter((reference) =>
      ["style", "material"].includes(reference.role)
    ),
    compositionImages: referenceImages.filter(
      (reference) => reference.role === "composition"
    ),
    colorLightingImages: referenceImages.filter((reference) =>
      ["style", "material", "scene"].includes(reference.role)
    ),
    layoutImages: referenceImages.filter((reference) => reference.role === "text"),
    usedSingleReferenceMode,
    usedFallbackReferenceImage
  };
}

function createGptImage2ReferenceUserContent(
  input: AssistantPromptInput,
  mapping: GptImage2ReferenceMapping
): ChatContent {
  const content: Array<TextContentPart | ImageContentPart> = [];

  mapping.subjectImages.forEach((reference, index) => {
    content.push({
      type: "text",
      text: [
        `以下是 subject_image ${index + 1}（主体图）：`,
        `插件标签：${reference.label}`,
        `用户指定角色：${getGptImage2RoleLabel(reference.role)}`,
        reference.sourceTitle ? `来源标题：${reference.sourceTitle}` : ""
      ]
        .filter(Boolean)
        .join("\n")
    });
    content.push(createImageContentPart(reference.imageUrl));
  });

  mapping.referenceImages.forEach((reference, index) => {
    content.push({
      type: "text",
      text: [
        `以下是 reference_image ${index + 1}（参考图）：`,
        `插件标签：${reference.label}`,
        `用户指定角色：${getGptImage2RoleLabel(reference.role)}`,
        reference.sourceTitle ? `来源标题：${reference.sourceTitle}` : ""
      ]
        .filter(Boolean)
        .join("\n")
    });
    content.push(createImageContentPart(reference.imageUrl));
  });

  content.push({
    type: "text",
    text: createGptImage2ReferenceRequestText(input, mapping)
  });

  return content;
}

function createImageContentPart(imageUrl: string): ImageContentPart {
  return {
    type: "image_url",
    image_url: {
      url: imageUrl,
      detail: "high"
    }
  };
}

function createGptImage2ReferenceRequestText(
  input: AssistantPromptInput,
  mapping: GptImage2ReferenceMapping
): string {
  const control = createGptImage2ControlSettings(input);
  const controlGuidance = createGptImage2ControlGuidance(input, control);

  return [
    "请基于以上图像角色生成 GPT-Image-2 图生图提示词优化结果。",
    "",
    `用户需求：${input.idea.trim()}`,
    input.extraSpecs?.trim() ? `补充要求：${input.extraSpecs.trim()}` : "",
    input.reverseContext
      ? `反推视觉参考补充：${createReverseContextPreviewText(input.reverseContext)}`
      : "",
    input.gptImage2?.exactText?.trim()
      ? `用户明确文案：${input.gptImage2.exactText.trim()}`
      : "",
    "",
    `是否提供 subject_image：${mapping.subjectImages.length ? "是" : "否"}`,
    `reference_mode：${mapping.referenceMode}`,
    `target_aspect_ratio：${mapping.aspectRatio}`,
    mapping.seed ? `seed：${mapping.seed}` : "",
    controlGuidance.length
      ? ["提示词控制约束：", ...controlGuidance.map((item) => `- ${item}`)].join("\n")
      : "",
    "",
    mapping.aspectRatio === "auto"
      ? "画幅规则：target_aspect_ratio 为 auto，不主动强制固定比例，根据用户需求、参考图和最终用途自然生成。"
      : `画幅规则：最终提示词必须明确写出目标比例 ${mapping.aspectRatio}，如果参考图比例不同，只参考视觉方向，最终构图需要适配 ${mapping.aspectRatio} 画幅。`,
    mapping.usedSingleReferenceMode
      ? "单图模式：当前只有 reference_image，不声明独立 subject_image；该图同时作为视觉参考和主题参考，但最终内容由用户需求决定。"
      : mapping.subjectImages.length
        ? "多图模式：subject_image 决定核心主体，reference_image 决定视觉方向，不允许 reference_image 中的主体替换 subject_image。"
        : "多图参考模式：当前没有独立 subject_image，所有图片都作为 reference_image 参与视觉参考，最终内容仍由用户需求决定。",
    "多图冲突优先级：用户明确需求 > 主体图 > 版式图 > 构图图 > 色彩光影图 > 风格图。",
    "人物关系：如果 reference_image 有人物、模特、手部或展示关系，且 reference_mode 是 auto 或 full_reference，应保留展示关系，但不复制具体身份、面部特征或品牌代言属性。",
    "文字关系：用户明确文案必须逐字保留；产品包装、标签、LOGO、型号等本体文字属于识别信息，应尽量保留；参考图旧文案不能机械照搬。",
    "",
    "多图角色说明：",
    mapping.subjectImages.length
      ? `subject_image 组：${mapping.subjectImages
          .map((reference) => `${reference.label}=${getGptImage2RoleLabel(reference.role)}`)
          .join("；")}`
      : "subject_image 组：无，按单图参考模式处理。",
    `reference_image 组：${mapping.referenceImages
      .map((reference) => `${reference.label}=${getGptImage2RoleLabel(reference.role)}`)
      .join("；")}`,
    mapping.styleImages.length
      ? `风格/材质参考：${mapping.styleImages.map((reference) => reference.label).join("、")}`
      : "",
    mapping.compositionImages.length
      ? `构图参考：${mapping.compositionImages.map((reference) => reference.label).join("、")}`
      : "",
    mapping.colorLightingImages.length
      ? `色彩光影参考：${mapping.colorLightingImages.map((reference) => reference.label).join("、")}`
      : "",
    mapping.layoutImages.length
      ? `版式文字参考：${mapping.layoutImages.map((reference) => reference.label).join("、")}`
      : "",
    "",
    "请严格输出 optimized_prompt: 和 reference_summary: 两部分。"
  ]
    .filter(Boolean)
    .join("\n");
}

function createGptImage2DraftPayload(
  input: AssistantPromptInput,
  control: GptImage2ControlSettings,
  aspectRatio: string
): Record<string, unknown> {
  return {
    layout_type: control.layoutType,
    optimize_strength: control.optimizeStrength,
    aspect_ratio: aspectRatio,
    direction: getGptImage2Direction(aspectRatio),
    user_prompt: input.idea.trim(),
    exact_text: input.gptImage2?.exactText?.trim() || "",
    text_policy: control.textPolicy,
    extra_specs: input.extraSpecs?.trim() || "",
    reverse_context: input.reverseContext
      ? createReverseContextPreviewText(input.reverseContext)
      : "",
    game_context: control.gameModeEnabled
      ? control.gameGuidance.join("\n")
      : ""
  };
}

function parseGptImage2PromptSchema(
  rawOutput: string
): GptImage2PromptSchema & { parseStatus: "parsed" | "fallback" } {
  const raw = stripMarkdownFence(rawOutput).trim();
  try {
    const parsed = JSON.parse(raw);
    if (isRecord(parsed)) {
      return {
        ...createEmptyGptImage2PromptSchema(),
        ...readGptImage2SchemaRecord(parsed),
        parseStatus: "parsed"
      };
    }
  } catch {
    // Fall through to a raw schema so normalization can still produce a prompt.
  }

  return {
    ...createEmptyGptImage2PromptSchema(),
    subject: raw,
    visual_focus: raw ? [raw] : [],
    parseStatus: "fallback"
  };
}

function normalizeGptImage2PromptSchema(
  schema: GptImage2PromptSchema,
  input: AssistantPromptInput,
  control: GptImage2ControlSettings,
  aspectRatio: string
): GptImage2PromptSchema {
  const exactText = input.gptImage2?.exactText?.trim() || "";
  const normalized: GptImage2PromptSchema = {
    ...schema,
    aspect_ratio: aspectRatio,
    direction: getGptImage2Direction(aspectRatio),
    layout_type: control.layoutType,
    optimize_strength: control.optimizeStrength,
    text_policy: control.textPolicy,
    constraints: schema.constraints.slice(0, 4),
    named_entities: Array.from(new Set(schema.named_entities.filter(Boolean))),
    game_context: control.gameModeEnabled
      ? control.gameGuidance.join("\n")
      : schema.game_context
  };

  if (control.textPolicy === "none") {
    return removeGptImage2TextHints({
      ...normalized,
      text_requirements: [],
      typography_plan: "无文字排版",
      copy_strategy: "无文字",
      information_hierarchy: stripGptImage2TextHintTerms(
        normalized.information_hierarchy
      ),
      layout_plan: stripGptImage2TextHintTerms(normalized.layout_plan),
      ui_layout: stripGptImage2TextHintTerms(normalized.ui_layout),
      constraints: [
        ...normalized.constraints.filter(
          (item) => !containsGptImage2PositiveTextHint(item)
        ),
        "画面中不主动添加标题、卖点、品牌区、信息栏或其他可读文字。"
      ].slice(0, 4)
    });
  }

  if (control.textPolicy === "preserve") {
    normalized.text_requirements = exactText ? [exactText] : [];
    normalized.copy_strategy = exactText
      ? "逐字保留用户指定文案"
      : normalized.copy_strategy;
  } else if (control.textPolicy === "enhance") {
    normalized.text_requirements = normalized.text_requirements.length
      ? normalized.text_requirements
      : exactText
        ? [exactText]
        : [];
    normalized.copy_strategy =
      normalized.copy_strategy || "在不改变核心含义的前提下优化画面文案";
  } else if (control.textPolicy === "generate") {
    normalized.text_requirements = normalized.text_requirements.slice(0, 6);
    normalized.copy_strategy =
      normalized.copy_strategy || "根据主题生成适合画面的核心文字";
  }

  if (exactText && !normalized.text_requirements.includes(exactText)) {
    normalized.text_requirements = [exactText, ...normalized.text_requirements];
  }

  return normalized;
}

function createEmptyGptImage2PromptSchema(): GptImage2PromptSchema {
  return {
    image_type: "",
    subject: "",
    action: "",
    environment: "",
    composition: "",
    style: "",
    lighting_color: "",
    visual_focus: [],
    layout_plan: "",
    typography_plan: "",
    copy_strategy: "",
    information_hierarchy: "",
    text_requirements: [],
    constraints: [],
    named_entities: [],
    ui_layout: "",
    game_context: "",
    aspect_ratio: "",
    direction: "",
    layout_type: "auto",
    optimize_strength: "standard",
    text_policy: "preserve"
  };
}

function readGptImage2SchemaRecord(record: Record<string, unknown>): GptImage2PromptSchema {
  return {
    image_type: readStringRecordValue(record.image_type),
    subject: readStringRecordValue(record.subject),
    action: readStringRecordValue(record.action),
    environment: readStringRecordValue(record.environment),
    composition: readStringRecordValue(record.composition),
    style: readStringRecordValue(record.style),
    lighting_color: readStringRecordValue(record.lighting_color),
    visual_focus: readStringArrayRecordValue(record.visual_focus).slice(0, 4),
    layout_plan: readStringRecordValue(record.layout_plan),
    typography_plan: readStringRecordValue(record.typography_plan),
    copy_strategy: readStringRecordValue(record.copy_strategy),
    information_hierarchy: readStringRecordValue(record.information_hierarchy),
    text_requirements: readStringArrayRecordValue(record.text_requirements),
    constraints: readStringArrayRecordValue(record.constraints),
    named_entities: readStringArrayRecordValue(record.named_entities),
    ui_layout: readStringRecordValue(record.ui_layout),
    game_context: readStringRecordValue(record.game_context),
    aspect_ratio: readStringRecordValue(record.aspect_ratio),
    direction: readStringRecordValue(record.direction),
    layout_type: readGptImage2LayoutType(record.layout_type, "auto"),
    optimize_strength: readGptImage2OptimizeStrength(
      record.optimize_strength,
      "standard"
    ),
    text_policy: readGptImage2TextPolicy(record.text_policy, "preserve")
  };
}

function removeGptImage2TextHints(
  schema: GptImage2PromptSchema
): GptImage2PromptSchema {
  return {
    ...schema,
    composition: stripGptImage2TextHintTerms(schema.composition),
    layout_plan: stripGptImage2TextHintTerms(schema.layout_plan),
    typography_plan: "无文字排版",
    copy_strategy: "无文字",
    information_hierarchy: stripGptImage2TextHintTerms(
      schema.information_hierarchy
    ),
    ui_layout: stripGptImage2TextHintTerms(schema.ui_layout),
    text_requirements: []
  };
}

function stripGptImage2TextHintTerms(value: string): string {
  return value
    .replace(
      /(?:预留|显示|添加)?(?:主标题|副标题|标题区|标题|卖点栏|卖点|品牌区|品牌字样|信息栏|文案|文字|标签|按钮文字|价格区|促销标签)/g,
      ""
    )
    .replace(/[，,；;、]{2,}/g, "，")
    .replace(/^[，,；;、\s]+|[，,；;、\s]+$/g, "")
    .trim();
}

function containsGptImage2PositiveTextHint(value: string): boolean {
  return /(?:添加|显示|预留|生成|包含).{0,12}(?:标题|文案|文字|卖点|品牌区|信息栏)|(?:标题区|卖点栏|品牌区|信息栏|主标题|副标题)/.test(
    value
  );
}

type GptImage2DraftPromptModule =
  (typeof GPT_IMAGE_2_DRAFT_PROMPT_MODULES)[number];

function createGptImage2DraftPromptAuditWarnings({
  input,
  prompt,
  aspectRatio,
  control
}: {
  input: AssistantPromptInput;
  prompt: string;
  aspectRatio: string;
  control: GptImage2ControlSettings;
}): string[] {
  return Array.from(
    new Set([
      ...createGptImage2PromptAuditWarnings({
        input,
        prompt,
        aspectRatio,
        control
      }),
      ...createGptImage2DraftModuleWarnings({
        input,
        prompt,
        aspectRatio,
        control
      })
    ])
  );
}

function createGptImage2DraftModuleWarnings({
  input,
  prompt,
  aspectRatio,
  control
}: {
  input: AssistantPromptInput;
  prompt: string;
  aspectRatio: string;
  control: GptImage2ControlSettings;
}): string[] {
  const warnings: string[] = [];
  const exactText = input.gptImage2?.exactText?.trim() || "";
  const positions = GPT_IMAGE_2_DRAFT_PROMPT_MODULES.map((module) => ({
    module,
    index: prompt.indexOf(`【${module}】`)
  }));
  const missingModules = positions
    .filter((item) => item.index < 0)
    .map((item) => item.module);

  if (missingModules.length) {
    warnings.push(`无图草案缺少固定模块：${missingModules.join("、")}`);
  }

  if (
    !missingModules.length &&
    positions.some((item, index) => {
      const previous = positions[index - 1];
      return Boolean(previous && item.index < previous.index);
    })
  ) {
    warnings.push("无图草案六模块顺序不符合规范");
  }

  const textSection = readGptImage2DraftModuleText(prompt, "文字要求");
  const constraintsSection = readGptImage2DraftModuleText(prompt, "限制条件");

  if (!textSection.trim()) {
    warnings.push("无图草案缺少独立的【文字要求】内容");
  }

  if (exactText && !textSection.includes(exactText)) {
    warnings.push("【文字要求】缺少用户指定文案");
  }

  if (
    control.textPolicy === "none" &&
    !/(?:无指定文字|不主动添加|不要主动添加|不要生成|不得出现|不出现).{0,24}(?:文字|标题|文案|品牌区|信息栏|卖点)/.test(
      textSection
    )
  ) {
    warnings.push("textPolicy=none 但【文字要求】未明确禁止主动生成文字");
  }

  if (
    control.textPolicy === "generate" &&
    control.optimizeStrength === "standard" &&
    !/必须且只能显示/.test(textSection)
  ) {
    warnings.push("generate+standard 但【文字要求】未使用“必须且只能显示”");
  }

  if (!constraintsSection.trim()) {
    warnings.push("无图草案缺少独立的【限制条件】内容");
  }

  if (
    aspectRatio !== "auto" &&
    constraintsSection.trim() &&
    !constraintsSection.includes(aspectRatio)
  ) {
    warnings.push("【限制条件】缺少目标画幅硬约束");
  }

  if (
    (control.textPolicy === "preserve" ||
      (control.textPolicy === "generate" &&
        control.optimizeStrength === "standard")) &&
    textSection.trim() &&
    constraintsSection.trim() &&
    !/(?:指定文字以外|额外可读文字|多余文字|只能显示|不得出现.*文字|不要添加.*文字)/.test(
      `${textSection}\n${constraintsSection}`
    )
  ) {
    warnings.push("【文字要求】或【限制条件】缺少禁止额外文字约束");
  }

  return warnings;
}

function readGptImage2DraftModuleText(
  prompt: string,
  module: GptImage2DraftPromptModule
): string {
  const modulePattern = GPT_IMAGE_2_DRAFT_PROMPT_MODULES.map(
    escapeGptImage2Regex
  ).join("|");
  const match = prompt.match(
    new RegExp(
      `【${escapeGptImage2Regex(module)}】\\s*([\\s\\S]*?)(?=\\n\\s*【(?:${modulePattern})】|$)`
    )
  );

  return match?.[1]?.trim() || "";
}

function escapeGptImage2Regex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function createGptImage2PromptAuditWarnings({
  input,
  prompt,
  aspectRatio,
  control,
  mapping
}: {
  input: AssistantPromptInput;
  prompt: string;
  aspectRatio: string;
  control: GptImage2ControlSettings;
  mapping?: GptImage2ReferenceMapping;
}): string[] {
  const warnings: string[] = [];
  const exactText = input.gptImage2?.exactText?.trim() || "";

  if (aspectRatio !== "auto" && !prompt.includes(aspectRatio)) {
    warnings.push(`最终提示词缺少目标画幅 ${aspectRatio}`);
  }

  if (exactText && !prompt.includes(exactText)) {
    warnings.push("最终提示词缺少用户指定文案");
  }

  if (
    control.textPolicy === "none" &&
    /(?:标题区|卖点栏|品牌区|信息栏|主标题|副标题|添加文案|显示文案|生成文案)/.test(
      prompt
    )
  ) {
    warnings.push("textPolicy=none 但提示词仍可能诱导生成文字区");
  }

  if (
    control.gameModeEnabled &&
    !matchesGptImage2GameUseCasePrompt(prompt, control.gameUseCase)
  ) {
    warnings.push(`游戏用途 ${control.gameUseCase} 的关键语义不明显`);
  }

  if (
    mapping?.subjectImages.length &&
    /reference_image.*(?:替换|取代|覆盖).*subject_image|参考图.*(?:替换|取代).*主体图/.test(
      prompt
    )
  ) {
    warnings.push("参考图优化疑似破坏 subject/reference 角色关系");
  }

  return warnings;
}

function applyGptImage2DraftLightRepair({
  prompt,
  input,
  aspectRatio,
  control,
  auditWarnings
}: {
  prompt: string;
  input: AssistantPromptInput;
  aspectRatio: string;
  control: GptImage2ControlSettings;
  auditWarnings: string[];
}): string {
  if (!auditWarnings.length) {
    return prompt;
  }

  let nextPrompt = prompt.trim();
  const exactText = input.gptImage2?.exactText?.trim() || "";
  const textRepairs: string[] = [];
  const constraintRepairs: string[] = [];

  if (auditWarnings.some((warning) => warning.includes("指定文案")) && exactText) {
    textRepairs.push(
      `画面必须显示以下文字：“${exactText}”。文字必须逐字逐符号准确，不得改写、翻译、删减或补标点。`
    );
  }

  if (
    auditWarnings.some(
      (warning) =>
        warning.includes("textPolicy=none") ||
        warning.includes("禁止主动生成文字")
    )
  ) {
    textRepairs.push(
      "无指定文字，画面中不要主动添加标题、卖点、品牌区、信息栏或其他可读文字。"
    );
  }

  if (
    auditWarnings.some((warning) => warning.includes("必须且只能显示"))
  ) {
    textRepairs.push("画面必须且只能显示【文字要求】中列出的文字。");
  }

  if (
    auditWarnings.some((warning) => warning.includes("目标画幅")) &&
    aspectRatio !== "auto"
  ) {
    constraintRepairs.push(
      `最终画幅严格适配 ${aspectRatio}，${getGptImage2Direction(aspectRatio)}。`
    );
  }

  if (
    auditWarnings.some((warning) => warning.includes("额外文字")) &&
    control.textPolicy !== "none"
  ) {
    constraintRepairs.push("不得出现指定文字以外的额外可读文字、装饰文字或无意义文字。");
  }

  if (auditWarnings.some((warning) => warning.includes("游戏用途"))) {
    const guidance = control.gameGuidance[0];
    if (guidance) {
      constraintRepairs.push(guidance);
    }
  }

  if (textRepairs.length) {
    nextPrompt = appendToGptImage2DraftModule(
      nextPrompt,
      "文字要求",
      textRepairs.join(" ")
    );
  }

  if (constraintRepairs.length) {
    nextPrompt = appendToGptImage2DraftModule(
      nextPrompt,
      "限制条件",
      constraintRepairs.join(" ")
    );
  }

  return nextPrompt;
}

function appendToGptImage2DraftModule(
  prompt: string,
  module: GptImage2DraftPromptModule,
  addition: string
): string {
  const trimmedAddition = addition.trim();
  if (!trimmedAddition) {
    return prompt;
  }

  const currentText = readGptImage2DraftModuleText(prompt, module);
  if (currentText.includes(trimmedAddition)) {
    return prompt;
  }

  const header = `【${module}】`;
  const headerIndex = prompt.indexOf(header);
  if (headerIndex < 0) {
    return [prompt.trim(), `${header}\n${trimmedAddition}`].filter(Boolean).join("\n\n");
  }

  const moduleHeaderPattern = new RegExp(
    `\\n\\s*【(?:${GPT_IMAGE_2_DRAFT_PROMPT_MODULES.map(
      escapeGptImage2Regex
    ).join("|")})】`,
    "g"
  );
  moduleHeaderPattern.lastIndex = headerIndex + header.length;
  const nextHeader = moduleHeaderPattern.exec(prompt);
  const insertIndex = nextHeader?.index ?? prompt.length;
  const before = prompt.slice(0, insertIndex).trimEnd();
  const after = prompt.slice(insertIndex).trimStart();
  const separator = before.endsWith(header) ? "\n" : " ";
  const repaired = `${before}${separator}${trimmedAddition}`;

  return [repaired, after].filter(Boolean).join("\n\n");
}

function applyGptImage2LightRepair({
  prompt,
  input,
  aspectRatio,
  control,
  auditWarnings
}: {
  prompt: string;
  input: AssistantPromptInput;
  aspectRatio: string;
  control: GptImage2ControlSettings;
  auditWarnings: string[];
}): string {
  if (!auditWarnings.length) {
    return prompt;
  }

  const repairs: string[] = [];
  const exactText = input.gptImage2?.exactText?.trim() || "";

  if (
    auditWarnings.some((warning) => warning.includes("目标画幅")) &&
    aspectRatio !== "auto"
  ) {
    repairs.push(`最终画幅明确为 ${aspectRatio}，${getGptImage2Direction(aspectRatio)}。`);
  }

  if (auditWarnings.some((warning) => warning.includes("指定文案")) && exactText) {
    repairs.push(`画面指定文案必须逐字清晰出现：“${exactText}”。`);
  }

  if (auditWarnings.some((warning) => warning.includes("textPolicy=none"))) {
    repairs.push("画面中不主动添加标题、卖点、品牌区、信息栏或其他可读文字。");
  }

  if (auditWarnings.some((warning) => warning.includes("游戏用途"))) {
    const guidance = control.gameGuidance[0];
    if (guidance) {
      repairs.push(guidance);
    }
  }

  return [prompt.trim(), repairs.join(" ")].filter(Boolean).join("\n\n");
}

function matchesGptImage2GameUseCasePrompt(
  prompt: string,
  useCase: GptImage2GameUseCase
): boolean {
  if (useCase === "none") {
    return true;
  }

  const checks: Record<GptImage2GameUseCase, RegExp> = {
    none: /./,
    ingame_screenshot:
      /in-game|game screenshot|游戏内镜头|真实游戏内|可操作空间|playable space|screenshot/i,
    environment_concept:
      /场景概念|世界观|地貌|建筑|探索路径|空间层次|environment concept/i,
    character_concept:
      /角色概念|身份|轮廓|服装|装备|可制作性|character concept/i,
    boss_arena:
      /BOSS|boss|尺度对比|战斗空间|低机位|越肩|arena/i,
    asset_breakdown:
      /资产拆分|模块化|材质边界|道具|建筑拆分|asset breakdown/i,
    ui_screenshot:
      /UI|HUD|信息层级|界面布局|游戏截图|ui screenshot/i
  };

  return checks[useCase].test(prompt);
}

function createGptImage2ControlSettings(
  input: AssistantPromptInput
): GptImage2ControlSettings {
  const options = input.gptImage2 ?? {};
  const gameUseCase = readGptImage2GameUseCase(options.gameUseCase, "none");
  const gameModeEnabled = Boolean(options.gameModeEnabled && gameUseCase !== "none");

  return {
    taskMode: readGptImage2TaskMode(options.taskMode, "reference"),
    layoutType: readGptImage2LayoutType(options.layoutType, "auto"),
    optimizeStrength: readGptImage2OptimizeStrength(
      options.optimizeStrength,
      "standard"
    ),
    textPolicy: readGptImage2TextPolicy(options.textPolicy, "preserve"),
    gameModeEnabled,
    gameUseCase,
    gameGenre: readGptImage2GameGenre(options.gameGenre, "auto"),
    gameGuidance: gameModeEnabled
      ? createGptImage2GameGuidance(gameUseCase, options.gameGenre)
      : []
  };
}

function createGptImage2ControlGuidance(
  input: AssistantPromptInput,
  control: GptImage2ControlSettings
): string[] {
  const exactText = input.gptImage2?.exactText?.trim() || "";

  return [
    `layout_type=${control.layoutType}，作为画面结构和信息密度倾向，不覆盖用户明确需求。`,
    `optimize_strength=${control.optimizeStrength}，standard 偏稳定可控，enhanced 偏创意和视觉冲击。`,
    `text_policy=${control.textPolicy}，必须按该策略处理画面文字。`,
    control.textPolicy === "none"
      ? "不主动添加标题、卖点、品牌区、信息栏或其他可读文字。"
      : "",
    control.textPolicy === "preserve" && exactText
      ? `指定文案必须逐字保留：“${exactText}”。`
      : "",
    control.gameModeEnabled
      ? control.gameGuidance.join(" ")
      : ""
  ].filter(Boolean);
}

function createGptImage2GameGuidance(
  useCase: GptImage2GameUseCase,
  rawGenre: unknown
): string[] {
  const genre = readGptImage2GameGenre(rawGenre, "auto");
  const genreText =
    genre === "auto" ? "" : `风格方向：${getGptImage2GameGenreLabel(genre)}。`;
  const base = genreText ? [genreText] : [];

  const cases: Record<GptImage2GameUseCase, string[]> = {
    none: [],
    ingame_screenshot: [
      "按真实游戏内镜头 / in-game screenshot 处理，强调可操作空间、角色与环境关系、镜头焦距、光影和材质可信度。",
      "除非用户明确要求 HUD 或选择 UI 截图，不要自动添加 HUD、血条、小地图或技能栏。"
    ],
    environment_concept: [
      "按游戏场景概念图处理，强调世界观、地貌、建筑、光影、探索路径、空间层次和环境叙事。"
    ],
    character_concept: [
      "按游戏角色概念图处理，强调身份、轮廓辨识度、服装装备、材质结构和可制作性。"
    ],
    boss_arena: [
      "按 BOSS 战斗场景处理，强调尺度对比、战斗空间、低机位或越肩构图、压迫感和可读的移动路线。"
    ],
    asset_breakdown: [
      "按游戏资产拆分处理，强调道具、建筑、材质、模块化边界和可制作拆分。"
    ],
    ui_screenshot: [
      "按游戏 UI 截图处理，强调 HUD/界面布局、信息层级、交互状态和游戏内截图可信度。"
    ]
  };

  return [...base, ...cases[useCase]];
}

function getGptImage2GameGenreLabel(genre: GptImage2GameGenre): string {
  const labels: Record<GptImage2GameGenre, string> = {
    auto: "自动判断",
    wuxia: "武侠/东方动作",
    fantasy: "奇幻",
    sci_fi: "科幻",
    realistic: "写实",
    stylized: "风格化"
  };

  return labels[genre];
}

function createGptImage2DebugInput(
  input: AssistantPromptInput,
  aspectRatio: string,
  control: GptImage2ControlSettings
): Partial<GptImage2DebugInfo["input"]> {
  return {
    task_mode: control.taskMode,
    layout_type: control.layoutType,
    optimize_strength: control.optimizeStrength,
    text_policy: control.textPolicy,
    game_mode_enabled: control.gameModeEnabled,
    ...(control.gameModeEnabled
      ? {
          game_use_case: control.gameUseCase,
          game_genre: control.gameGenre,
          game_prompt_guidance: control.gameGuidance
        }
      : {}),
    aspect_ratio: aspectRatio,
    direction: getGptImage2Direction(aspectRatio),
    has_exact_text: Boolean(input.gptImage2?.exactText?.trim())
  };
}

function createEmptyGptImage2DebugMapping(): GptImage2DebugInfo["image_mapping"] {
  return {
    subject_images: [],
    reference_images: [],
    style_images: [],
    composition_images: [],
    color_lighting_images: [],
    layout_images: []
  };
}

function createGptImage2DraftNegativeConstraints(
  control: GptImage2ControlSettings
): string[] {
  return [
    "不要用空泛质量词堆砌替代具体构图、材质、光影和用途。",
    control.textPolicy === "none"
      ? "不要主动添加标题、卖点、品牌区、信息栏或其他可读文字。"
      : "",
    control.gameModeEnabled && control.gameUseCase !== "ui_screenshot"
      ? "不要自动添加无关 HUD、血条、小地图或技能栏。"
      : ""
  ].filter(Boolean);
}

function createGptImage2DraftChecklist(
  schema: GptImage2PromptSchema,
  warnings: string[]
): string[] {
  return [
    "输出格式：固定六模块【图像类型】【主体】【场景背景】【构图与风格】【文字要求】【限制条件】。",
    `画面类型：${schema.image_type || schema.layout_type}。`,
    `目标画幅：${schema.aspect_ratio}，${schema.direction}。`,
    schema.subject ? `主体：${schema.subject}。` : "",
    schema.environment ? `场景：${schema.environment}。` : "",
    schema.text_requirements.length
      ? `文字要求：${schema.text_requirements.join("、")}。`
      : "文字要求：无指定文字。",
    schema.game_context ? "游戏上下文：已写入 schema。" : "",
    warnings.length ? `审计告警：${warnings.join("；")}` : "审计检查：未发现关键约束缺失。"
  ].filter(Boolean);
}

function parseGptImage2OptimizerOutput(
  rawOutput: string
): GptImage2ParsedOptimizerOutput {
  const output = stripMarkdownFence(rawOutput).trim();
  const match = output.match(
    /optimized_prompt\s*[:：]\s*([\s\S]*?)(?:\n\s*reference_summary\s*[:：]\s*([\s\S]*))?$/i
  );
  const optimizedPrompt = normalizeGptImage2OptimizedPrompt(
    match?.[1]?.trim() || ""
  );
  const referenceSummary = (match?.[2] ?? "").trim();

  if (optimizedPrompt) {
    return {
      optimizedPrompt,
      referenceSummary,
      parseStatus: "parsed"
    };
  }

  return {
    optimizedPrompt: output,
    referenceSummary: "",
    parseStatus: "fallback"
  };
}

function normalizeGptImage2OptimizedPrompt(value: string): string {
  return value
    .replace(/^optimized_prompt\s*[:：]\s*/i, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function createGptImage2FormatWarnings(
  mapping: GptImage2ReferenceMapping,
  parsed: GptImage2ParsedOptimizerOutput
): string[] {
  const prompt = parsed.optimizedPrompt.trim();
  const paragraphCount = countGptImage2PromptParagraphs(prompt);
  const warnings: string[] = [];

  if (parsed.parseStatus === "fallback") {
    warnings.push("模型未按 optimized_prompt/reference_summary 字段返回，已使用完整输出兜底。");
  }

  if (!parsed.referenceSummary.trim()) {
    warnings.push("缺少 reference_summary，无法单独展示参考图视觉特征总结。");
  }

  if (paragraphCount < 3 || paragraphCount > 4) {
    warnings.push(`optimized_prompt 当前约 ${paragraphCount} 段，应为 3 到 4 个自然段。`);
  }

  if (/[【】]/.test(prompt) || /^\s*(?:[-*•]|\d+[.、)]|[一二三四五六七八九十]+[.、])\s+/m.test(prompt)) {
    warnings.push("optimized_prompt 疑似包含标题、项目符号或编号列表。");
  }

  if (
    /^(?:subject_image|reference_image|reference_mode|target_aspect_ratio|user_prompt)\s*[:：]/im.test(
      prompt
    )
  ) {
    warnings.push("optimized_prompt 疑似写成配置字段，建议保持自然段提示词。");
  }

  if (/保留参考图原有文字内容|直接沿用参考图文字|照搬参考图文字/.test(prompt)) {
    warnings.push("optimized_prompt 疑似要求机械照搬参考图旧文案。");
  }

  if (/不要主动生成文案|如需(?:要)?文字|如果需要文字/.test(prompt)) {
    warnings.push("optimized_prompt 疑似回避文字处理，应根据参考图版式和用户文案明确处理。");
  }

  if (
    mapping.aspectRatio !== "auto" &&
    !prompt.includes(mapping.aspectRatio)
  ) {
    warnings.push(`target_aspect_ratio 为 ${mapping.aspectRatio}，但 optimized_prompt 未明确写出该比例。`);
  }

  return warnings;
}

function countGptImage2PromptParagraphs(prompt: string): number {
  if (!prompt.trim()) {
    return 0;
  }

  return prompt.split(/\n\s*\n/).filter((paragraph) => paragraph.trim()).length;
}

function createGptImage2Questions(
  input: AssistantPromptInput,
  mapping: GptImage2ReferenceMapping,
  formatWarnings: string[]
): string[] {
  return [
    mapping.usedFallbackReferenceImage
      ? "没有独立视觉参考图，已把最后一张主体候选图作为 reference_image 兜底。"
      : "",
    mapping.usedSingleReferenceMode
      ? "当前只有一张参考图，已按单图模式处理，不声明独立 subject_image。"
      : "",
    input.gptImage2?.exactText?.trim()
      ? ""
      : "如画面必须出现固定文案，建议填写“指定文案”。",
    ...formatWarnings
  ].filter(Boolean);
}

function createGptImage2Assumptions(
  mapping: GptImage2ReferenceMapping
): string[] {
  return [
    "GPT-Image-2 助手只优化图生图提示词，不直接生成图片。",
    "图像角色判断在提示词优化层完成，后续图像生成节点仍需按相同顺序传入参考图。",
    mapping.subjectImages.length
      ? "identity / product 角色被视为 subject_image，用于保留主体外观、结构、比例和识别文字。"
      : "未提供独立主体图，reference_image 同时作为视觉参考和主题参考。"
  ];
}

function createGptImage2NegativeConstraints(
  mapping: GptImage2ReferenceMapping
): string[] {
  return [
    mapping.subjectImages.length
      ? "不要让 reference_image 中的产品、人物或主体替换 subject_image 的核心主体。"
      : "",
    "不要机械照搬参考图中的旧文案；用户明确文案优先。",
    "不要把所有参考图混成无角色的普通 images[]。"
  ].filter(Boolean);
}

function createGptImage2Checklist(
  mapping: GptImage2ReferenceMapping,
  parsed: GptImage2ParsedOptimizerOutput,
  formatWarnings: string[]
): string[] {
  const paragraphCount = countGptImage2PromptParagraphs(parsed.optimizedPrompt);

  return [
    `参考模式：${mapping.referenceMode}。`,
    `目标画幅：${mapping.aspectRatio}，${mapping.direction}。`,
    mapping.subjectImages.length
      ? `主体图：${mapping.subjectImages.map((reference) => reference.label).join("、")}。`
      : "主体图：无，按单图参考模式处理。",
    `参考图：${mapping.referenceImages.map((reference) => reference.label).join("、")}。`,
    mapping.layoutImages.length
      ? `版式文字参考：${mapping.layoutImages.map((reference) => reference.label).join("、")}。`
      : "未单独指定版式文字参考图。",
    parsed.parseStatus === "parsed"
      ? "输出已解析出 optimized_prompt 和 reference_summary。"
      : "输出字段解析失败，已启用完整输出兜底。",
    `optimized_prompt 段落数：${paragraphCount}。`,
    formatWarnings.length
      ? `格式告警：${formatWarnings.join("；")}`
      : "格式检查：未发现明显结构告警。"
  ];
}

function createGptImage2DebugMapping(
  mapping: GptImage2ReferenceMapping
): GptImage2DebugInfo["image_mapping"] {
  return {
    subject_images: mapping.subjectImages.map(createGptImage2DebugItem),
    reference_images: mapping.referenceImages.map(createGptImage2DebugItem),
    style_images: mapping.styleImages.map(createGptImage2DebugItem),
    composition_images: mapping.compositionImages.map(createGptImage2DebugItem),
    color_lighting_images: mapping.colorLightingImages.map(
      createGptImage2DebugItem
    ),
    layout_images: mapping.layoutImages.map(createGptImage2DebugItem)
  };
}

function createGptImage2DebugItem(
  reference: GptImage2MappedReference
): GptImage2ReferenceDebugItem {
  return {
    label: reference.label,
    role: reference.role,
    ...(reference.sourceTitle ? { sourceTitle: reference.sourceTitle } : {})
  };
}

function getGptImage2RoleLabel(role: AssistantReferenceRole): string {
  const labels: Record<AssistantReferenceRole, string> = {
    identity: "主体/身份参考",
    product: "主体/产品参考",
    style: "风格参考",
    composition: "构图参考",
    scene: "场景参考",
    text: "版式文字参考",
    material: "材质参考"
  };

  return labels[role];
}

function readGptImage2ReferenceMode(
  value: unknown,
  fallback: GptImage2ReferenceMode
): GptImage2ReferenceMode {
  return GPT_IMAGE_2_REFERENCE_MODES.includes(value as GptImage2ReferenceMode)
    ? (value as GptImage2ReferenceMode)
    : fallback;
}

function readGptImage2TaskMode(
  value: unknown,
  fallback: GptImage2TaskMode
): GptImage2TaskMode {
  return GPT_IMAGE_2_TASK_MODES.includes(value as GptImage2TaskMode)
    ? (value as GptImage2TaskMode)
    : fallback;
}

function readGptImage2LayoutType(
  value: unknown,
  fallback: GptImage2LayoutType
): GptImage2LayoutType {
  return GPT_IMAGE_2_LAYOUT_TYPES.includes(value as GptImage2LayoutType)
    ? (value as GptImage2LayoutType)
    : fallback;
}

function readGptImage2OptimizeStrength(
  value: unknown,
  fallback: GptImage2OptimizeStrength
): GptImage2OptimizeStrength {
  return GPT_IMAGE_2_OPTIMIZE_STRENGTHS.includes(
    value as GptImage2OptimizeStrength
  )
    ? (value as GptImage2OptimizeStrength)
    : fallback;
}

function readGptImage2TextPolicy(
  value: unknown,
  fallback: GptImage2TextPolicy
): GptImage2TextPolicy {
  return GPT_IMAGE_2_TEXT_POLICIES.includes(value as GptImage2TextPolicy)
    ? (value as GptImage2TextPolicy)
    : fallback;
}

function readGptImage2GameUseCase(
  value: unknown,
  fallback: GptImage2GameUseCase
): GptImage2GameUseCase {
  return GPT_IMAGE_2_GAME_USE_CASES.includes(value as GptImage2GameUseCase)
    ? (value as GptImage2GameUseCase)
    : fallback;
}

function readGptImage2GameGenre(
  value: unknown,
  fallback: GptImage2GameGenre
): GptImage2GameGenre {
  return GPT_IMAGE_2_GAME_GENRES.includes(value as GptImage2GameGenre)
    ? (value as GptImage2GameGenre)
    : fallback;
}

function readGptImage2TargetAspectRatio(
  value: unknown,
  fallback: AssistantAspectRatio
): "auto" | AssistantAspectRatio {
  if (value === "auto") {
    return "auto";
  }

  return normalizeAssistantAspectRatio(value) ?? fallback;
}

function getGptImage2Direction(aspectRatio: string): string {
  if (aspectRatio === "auto") {
    return "不主动强制比例，根据用户需求和参考图自然生成";
  }

  const [rawWidth, rawHeight] = aspectRatio.split(":");
  const width = Number(rawWidth);
  const height = Number(rawHeight);

  if (!Number.isFinite(width) || !Number.isFinite(height) || height <= 0) {
    return "横版构图";
  }

  if (width > height) {
    return "横版构图";
  }

  if (height > width) {
    return "竖版构图";
  }

  return "方形构图";
}

function createReverseContextPreviewText(context: AssistantReverseContext): string {
  return [
    context.promptText.trim(),
    context.negativePrompt?.trim() ? `负面约束：${context.negativePrompt.trim()}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

function createNanoBananaAssistantUserContent(
  input: AssistantPromptInput
): ChatContent {
  const aspectRatio = normalizeAssistantAspectRatio(input.aspectRatio) ?? "16:9";
  const reverseContextText = createAssistantReverseContextText(input.reverseContext);
  const effectiveIdea =
    input.idea.trim() ||
    "Use the reverse-engineered JSON context as the main visual direction. Continue its style, composition, camera, lighting, color, material, mood, and negative constraints in a reusable new-image prompt.";
  const text = [
    "Create a Nano Banana Pro prompt from this request.",
    "",
    `Mode: ${input.mode}`,
    `Aspect ratio: ${aspectRatio}`,
    `Resolution: ${input.resolution}`,
    `Identity lock: ${input.identityLock ? "enabled" : "disabled"}`,
    input.extraSpecs?.trim() ? `Extra specs: ${input.extraSpecs.trim()}` : "",
    "",
    "User idea:",
    effectiveIdea,
    "",
    reverseContextText,
    "",
    input.references.length
      ? [
          "Reference images:",
          ...input.references.map((reference, index) =>
            [
              `Image ${index + 1}`,
              `Role: ${reference.role}`,
              `Label: ${reference.label ?? `Image ${index + 1}`}`,
              `Source title: ${reference.sourceTitle ?? "unknown"}`,
              `Source URL: ${reference.sourceImageUrl ?? "unknown"}`
            ].join("\n")
          )
        ].join("\n")
      : "Reference images: none",
    "",
    "Return JSON only. Use finalPrompt for the polished English prompt that the user can copy directly into Nano Banana Pro.",
    "Also return chineseCheck so the user can review the English prompt in Chinese: backTranslation, checklist, possibleIssues.",
    input.reverseContext
      ? "In chineseCheck, explicitly mention that the reverse-engineered JSON context was used for style, composition, camera, lighting, and color direction."
      : ""
  ]
    .filter(Boolean)
    .join("\n");

  if (!input.references.some((reference) => reference.imageUrl)) {
    return text;
  }

  return [
    {
      type: "text",
      text
    },
    ...input.references
      .filter((reference) => Boolean(reference.imageUrl))
      .map((reference) => ({
        type: "image_url" as const,
        image_url: {
          url: reference.imageUrl!,
          detail: "high" as const
        }
      }))
  ];
}

function createAssistantReverseContextText(
  context: AssistantReverseContext | undefined
): string {
  if (!context) {
    return "Reverse-engineered JSON context: none";
  }

  const fieldLines = REVERSE_CONTEXT_FIELD_KEYS.map((key) => {
    const value = context.fields[key]?.trim();

    return value ? `${key}: ${value}` : "";
  }).filter(Boolean);

  return [
    "Reverse-engineered JSON context:",
    `Source type: ${context.sourceType}`,
    context.templateName ? `Template: ${context.templateName}` : "",
    context.promptText.trim() ? `Prompt text: ${context.promptText.trim()}` : "",
    context.negativePrompt?.trim()
      ? `Negative prompt: ${context.negativePrompt.trim()}`
      : "",
    fieldLines.length ? ["Fields:", ...fieldLines].join("\n") : "",
    "Structured JSON:",
    truncateForModelContext(context.structuredJson, 8000)
  ]
    .filter(Boolean)
    .join("\n");
}

function truncateForModelContext(value: string, maxLength: number): string {
  const trimmed = value.trim();

  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return `${trimmed.slice(0, maxLength)}\n...[truncated]`;
}

function createMidjourneyAssistantUserContent(
  input: AssistantPromptInput
): ChatContent {
  const renderQuality = input.renderQuality ?? "hd";
  const aspectRatio = normalizeAssistantAspectRatio(input.aspectRatio) ?? "1:1";
  const reverseContextText = createAssistantReverseContextText(input.reverseContext);
  const effectiveIdea =
    input.idea.trim() ||
    "Use the reverse-engineered JSON context as the main visual direction. Continue its style, composition, camera, lighting, color, material, and mood as a reusable Midjourney prompt. Do not rigidly copy the original subject unless it is essential to the style.";
  const text = [
    "Create a Midjourney V8.1 prompt from this request.",
    "",
    `Mode: ${input.mode}`,
    `Aspect ratio: ${aspectRatio}`,
    `Render quality: ${renderQuality}`,
    `Raw mode: ${input.rawEnabled === false ? "disabled" : "enabled"}`,
    `Stylize: ${normalizeInteger(input.stylize, getDefaultMidjourneyStylize(input))}`,
    `Chaos: ${normalizeInteger(input.chaos, 0)}`,
    `Weird: ${normalizeInteger(input.weird, 0)}`,
    input.seed?.trim() ? `Seed: ${input.seed.trim()}` : "",
    input.personalizationCode?.trim()
      ? `Personalization: ${input.personalizationCode.trim()}`
      : "",
    input.identityLock
      ? "Identity consistency requested: V8.1 does not support --cref/--cw or --oref/--ow. Explain this in Chinese and use image prompt + clear text description + seed as weaker alternatives."
      : "Identity consistency requested: no",
    input.negativePrompt?.trim()
      ? `Negative prompt requested: ${input.negativePrompt.trim()}`
      : "",
    input.compositionRecipe?.promptText.trim()
      ? [
          `Composition recipe: ${input.compositionRecipe.name.trim() || "Custom composition recipe"}`,
          `Composition recipe prompt text: ${input.compositionRecipe.promptText.trim()}`,
          input.compositionRecipe.negativePrompt?.trim()
            ? `Composition recipe negative constraints: ${input.compositionRecipe.negativePrompt.trim()}`
            : "",
          "The final prompt must preserve these selected shot-size, camera, lens, structure, depth, scale, and focal-hierarchy details as visible composition."
        ]
          .filter(Boolean)
          .join("\n")
      : "",
    input.lightingRecipe?.promptText.trim()
      ? [
          `Lighting recipe: ${input.lightingRecipe.name.trim() || "Custom lighting recipe"}`,
          `Lighting recipe prompt text: ${input.lightingRecipe.promptText.trim()}`,
          input.lightingRecipe.negativePrompt?.trim()
            ? `Lighting recipe negative constraints: ${input.lightingRecipe.negativePrompt.trim()}`
            : "",
          "The final prompt must preserve these selected shadow-shape, placement, shadow-edge, light-dark ratio, cast-source, and fill-light details as visible scene structure."
        ]
          .filter(Boolean)
          .join("\n")
      : "",
    input.colorRecipe?.promptText.trim()
      ? [
          `Color recipe: ${input.colorRecipe.name.trim() || "Custom color recipe"}`,
          `Color recipe prompt text: ${input.colorRecipe.promptText.trim()}`,
          input.colorRecipe.negativePrompt?.trim()
            ? `Color recipe negative constraints: ${input.colorRecipe.negativePrompt.trim()}`
            : "",
          "The final prompt must preserve these selected dominant palette, shadow color, highlight color, accent color, saturation, tonal range, and color-grading details."
        ]
          .filter(Boolean)
          .join("\n")
      : "",
    input.extraSpecs?.trim() ? `Extra specs: ${input.extraSpecs.trim()}` : "",
    "",
    "User idea:",
    effectiveIdea,
    "",
    reverseContextText,
    "",
    input.references.length
      ? [
          "Reference images:",
          ...input.references.map((reference, index) =>
            [
              `Image ${index + 1}`,
              `Role: ${reference.role}`,
              `Label: ${reference.label ?? `Image ${index + 1}`}`,
              `Source title: ${reference.sourceTitle ?? "unknown"}`,
              `MJ usable URL or placeholder: ${getMidjourneyReferenceUrl(
                reference,
                index
              )}`,
              `Source URL: ${reference.sourceImageUrl ?? "unknown"}`,
              reference.role === "style"
                ? "Use as --sref when a usable URL exists; use a placeholder if local."
                : "Use as an image prompt when a usable URL exists; use a placeholder if local."
            ].join("\n")
          )
        ].join("\n")
      : "Reference images: none",
    "",
    "Final prompt rules:",
    "1. finalPrompt must be one English Midjourney V8.1 prompt only, with all parameters at the end.",
    "2. Include --v 8.1. Do not include --q, --quality, --cref, --cw, --oref, --ow, --draft, --niji, or ::.",
    "3. If a local reference has no public URL, use placeholders like <image-1-url> instead of data URLs.",
    "4. If optional composition, lighting, or color recipes are provided, include their concrete wording in this order in the visual body: composition, lighting, color. Do not replace them with generic cinematic adjectives.",
    "5. Return JSON only. Use chineseCheck to explain the prompt and parameter choices in Chinese.",
    input.reverseContext
      ? "6. In chineseCheck, explicitly mention that the reverse-engineered JSON context was used for style, composition, camera, lighting, and color direction."
      : ""
  ]
    .filter(Boolean)
    .join("\n");

  if (!input.references.some((reference) => reference.imageUrl)) {
    return text;
  }

  return [
    {
      type: "text",
      text
    },
    ...input.references
      .filter((reference) => Boolean(reference.imageUrl))
      .map((reference) => ({
        type: "image_url" as const,
        image_url: {
          url: reference.imageUrl!,
          detail: "high" as const
        }
      }))
  ];
}

function normalizeNanoBananaAssistantResult(
  result: AssistantPromptResult,
  input: AssistantPromptInput
): AssistantPromptResult {
  if (!input.reverseContext) {
    return result;
  }

  const reverseContextChecks = [
    "已使用反推 JSON 中的风格、构图、镜头、光影和色彩作为提示词方向。",
    input.idea.trim()
      ? "用户补充想法优先，反推 JSON 只作为视觉语言参考。"
      : "未填写新想法，默认延续反推图的视觉语言生成可复用提示词。"
  ];
  const chineseCheck = result.chineseCheck
    ? {
        ...result.chineseCheck,
        checklist: mergeUniqueStrings(
          result.chineseCheck.checklist,
          reverseContextChecks
        )
      }
    : {
        backTranslation: "已根据反推 JSON 的风格、构图、镜头、光影和色彩整理为 Nano Banana Pro 英文提示词。",
        checklist: reverseContextChecks,
        possibleIssues: []
      };

  const normalizedResult: AssistantPromptResult = {
    ...result,
    assumptions: mergeUniqueStrings(result.assumptions, [
      input.idea.trim()
        ? "反推 JSON 作为风格、构图和镜头参考，不强制复刻原图主体。"
        : "未填写新想法，默认延续反推图的视觉风格、构图和镜头语言。"
    ]),
    negativeConstraints: mergeUniqueStrings(
      result.negativeConstraints,
      readNegativePromptItems(input.reverseContext.negativePrompt)
    ),
    chineseCheck
  };

  return normalizedResult;

}

function normalizeMidjourneyAssistantResult(
  result: AssistantPromptResult,
  input: AssistantPromptInput
): AssistantPromptResult {
  const sanitizedPrompt = sanitizeMidjourneyFinalPrompt(result.finalPrompt, input);
  const warnings = createMidjourneyWarnings(result.finalPrompt, input);
  const chineseCheck = result.chineseCheck
    ? {
        ...result.chineseCheck,
        checklist: mergeUniqueStrings(
          result.chineseCheck.checklist,
          createMidjourneyChecklist(input)
        ),
        possibleIssues: mergeUniqueStrings(
          result.chineseCheck.possibleIssues,
          warnings
        )
      }
    : {
        backTranslation: "已按 Midjourney V8.1 规范整理为英文提示词，参数统一放在末尾。",
        checklist: createMidjourneyChecklist(input),
        possibleIssues: warnings
      };

  const normalizedResult: AssistantPromptResult = {
    ...result,
    brief: result.brief || "Midjourney V8.1 提示词已生成",
    finalPrompt: sanitizedPrompt,
    questions: mergeUniqueStrings(result.questions, warnings),
    assumptions: mergeUniqueStrings(result.assumptions, [
      "默认使用 Midjourney V8.1，不混用 Niji 或 V7 专用参数。",
      input.renderQuality === "sd"
        ? "当前按快速探索输出 SD。"
        : "当前按定稿质量输出 HD。"
    ]),
    negativeConstraints: mergeUniqueStrings(
      result.negativeConstraints,
      [
        ...readNegativePromptItems(input.negativePrompt),
        ...readNegativePromptItems(input.compositionRecipe?.negativePrompt),
        ...readNegativePromptItems(input.lightingRecipe?.negativePrompt),
        ...readNegativePromptItems(input.colorRecipe?.negativePrompt)
      ]
    ),
    chineseCheck
  };

  if (!input.reverseContext) {
    return normalizedResult;
  }

  return {
    ...normalizedResult,
    assumptions: mergeUniqueStrings(normalizedResult.assumptions, [
      input.idea.trim()
        ? "反推 JSON 作为风格、构图和镜头参考，不强制复刻原图主体。"
        : "未填写新想法，默认延续反推图的视觉风格、构图和镜头语言。"
    ]),
    negativeConstraints: mergeUniqueStrings(
      normalizedResult.negativeConstraints,
      readNegativePromptItems(input.reverseContext.negativePrompt)
    )
  };
}

function sanitizeMidjourneyFinalPrompt(
  finalPrompt: string,
  input: AssistantPromptInput
): string {
  const existingNegativePrompt = extractMidjourneyNoParameter(finalPrompt);
  let body = stripMarkdownFence(finalPrompt)
    .replace(/^\/imagine\s+prompt:\s*/i, "")
    .replace(MIDJOURNEY_V81_UNSUPPORTED_PARAMETER_PATTERN, "")
    .replace(/::\s*-?\d*(?:\.\d+)?/g, ", ");

  for (const pattern of MIDJOURNEY_PARAMETER_PATTERNS) {
    body = body.replace(pattern, "");
  }

  body = body
    .replace(/\s+/g, " ")
    .replace(/[,\s]+$/g, "")
    .trim();

  body = mergeMidjourneyRecipeTextIntoPrompt(body, [
    input.compositionRecipe?.promptText,
    input.lightingRecipe?.promptText,
    input.colorRecipe?.promptText
  ]);

  const referencePrefix = createMidjourneyImagePromptPrefix(input);
  const suffix = createMidjourneyParameterSuffix(
    input,
    existingNegativePrompt
  );
  const promptBody = [referencePrefix, body].filter(Boolean).join(" ").trim();

  return [promptBody || createAssistantFallbackPrompt(input), suffix]
    .filter(Boolean)
    .join(" ")
    .trim();
}

function createAssistantFallbackPrompt(input: AssistantPromptInput): string {
  const reverseContextPrompt = input.reverseContext?.promptText?.trim();

  if (reverseContextPrompt) {
    return reverseContextPrompt;
  }

  return input.idea.trim();
}

function createMidjourneyImagePromptPrefix(input: AssistantPromptInput): string {
  return input.references
    .map((reference, index) =>
      reference.role !== "style" ? getMidjourneyReferenceUrl(reference, index) : ""
    )
    .filter(Boolean)
    .join(" ");
}

function createMidjourneyParameterSuffix(
  input: AssistantPromptInput,
  existingNegativePrompt: string
): string {
  const aspectRatio = normalizeAssistantAspectRatio(input.aspectRatio) ?? "1:1";
  const parts = [`--ar ${aspectRatio}`, "--v 8.1"];

  if (input.rawEnabled !== false) {
    parts.push("--raw");
  }

  parts.push(input.renderQuality === "sd" ? "--sd" : "--hd");
  parts.push(`--s ${normalizeInteger(input.stylize, getDefaultMidjourneyStylize(input), 0, 1000)}`);

  const chaos = normalizeInteger(input.chaos, 0, 0, 100);
  const weird = normalizeInteger(input.weird, 0, 0, 3000);
  const seed = input.seed?.trim();
  const personalizationCode = input.personalizationCode?.trim();
  const imagePromptPrefix = createMidjourneyImagePromptPrefix(input);
  const styleReferences = input.references.filter(
    (reference) => reference.role === "style"
  );

  if (chaos > 0) {
    parts.push(`--c ${chaos}`);
  }

  if (weird > 0) {
    parts.push(`--w ${weird}`);
  }

  if (seed && /^\d+$/.test(seed)) {
    parts.push(`--seed ${seed}`);
  }

  if (imagePromptPrefix) {
    parts.push("--iw 1");
  }

  if (styleReferences.length) {
    const styleUrls = input.references
      .map((reference, index) =>
        reference.role === "style" ? getMidjourneyReferenceUrl(reference, index) : ""
      )
      .filter(Boolean);

    if (styleUrls.length) {
      parts.push(`--sref ${styleUrls.join(" ")}`, "--sw 100");
    }
  }

  if (personalizationCode) {
    parts.push(`--p ${personalizationCode}`);
  }

  const negativePrompt = normalizeMidjourneyNegativePrompt(
    [
      input.negativePrompt,
      input.compositionRecipe?.negativePrompt,
      input.lightingRecipe?.negativePrompt,
      input.colorRecipe?.negativePrompt,
      input.reverseContext?.negativePrompt,
      existingNegativePrompt
    ]
      .filter(Boolean)
      .join(", ")
  );

  if (negativePrompt) {
    parts.push(`--no ${negativePrompt}`);
  }

  return parts.join(" ");
}

function mergeMidjourneyRecipeTextIntoPrompt(
  body: string,
  recipeTexts: Array<string | undefined>
): string {
  const recipeText = recipeTexts
    .map((item) => item?.trim())
    .filter(Boolean)
    .join(", ");

  if (!recipeText) {
    return body;
  }

  const normalizedBody = normalizePromptClauseForComparison(body);
  const missingClauses = splitPromptClauses(recipeText).filter((clause) => {
    const normalizedClause = normalizePromptClauseForComparison(clause);

    return normalizedClause && !normalizedBody.includes(normalizedClause);
  });

  if (!missingClauses.length) {
    return body;
  }

  return [body, missingClauses.join(", ")].filter(Boolean).join(", ");
}

function createMidjourneyChecklist(input: AssistantPromptInput): string[] {
  const aspectRatio = normalizeAssistantAspectRatio(input.aspectRatio) ?? "1:1";
  const checklist = [
    `画幅比例：${aspectRatio}`,
    "模型：已使用 --v 8.1",
    input.rawEnabled === false ? "Raw：未启用" : "Raw：已启用",
    input.renderQuality === "sd" ? "质量：SD 快速探索" : "质量：HD 定稿",
    `Stylize：${normalizeInteger(input.stylize, getDefaultMidjourneyStylize(input), 0, 1000)}`
  ];

  if (input.references.length) {
    checklist.push("参考图：风格参考使用 --sref，其它参考图使用 image prompt URL 或占位符。");
  }

  if (input.negativePrompt?.trim()) {
    checklist.push("负面参数：已整理到 --no。");
  }

  if (input.compositionRecipe?.promptText.trim()) {
    checklist.push(`构图配方：${input.compositionRecipe.name || "自定义构图"} 已写入 MJ Prompt 正文。`);
  }

  if (input.lightingRecipe?.promptText.trim()) {
    checklist.push(`光影配方：${input.lightingRecipe.name || "自定义光影"} 已写入 MJ Prompt 正文。`);
  }

  if (input.colorRecipe?.promptText.trim()) {
    checklist.push(`配色配方：${input.colorRecipe.name || "自定义配色"} 已写入 MJ Prompt 正文。`);
  }

  if (input.reverseContext) {
    checklist.push("已带入反推 JSON 的风格、构图、镜头、光影和色彩方向。");
  }

  return checklist;
}

function createMidjourneyWarnings(
  originalPrompt: string,
  input: AssistantPromptInput
): string[] {
  const warnings: string[] = [];

  if (MIDJOURNEY_V81_UNSUPPORTED_PARAMETER_PATTERN.test(originalPrompt)) {
    warnings.push("已移除 V8.1 不支持的 --q、--cref、--cw、--oref、--ow 或 --draft 参数。");
  }
  MIDJOURNEY_V81_UNSUPPORTED_PARAMETER_PATTERN.lastIndex = 0;

  if (originalPrompt.includes("::")) {
    warnings.push("V8.1 不支持多重提示词 ::，已改为自然语言权重表达。");
  }

  if (
    input.identityLock ||
    input.references.some((reference) => reference.role === "identity")
  ) {
    warnings.push("V8.1 不支持角色/Omni Reference；身份参考会作为 image prompt 和文字描述使用。");
  }

  if (input.references.some((reference, index) => isMidjourneyPlaceholderUrl(getMidjourneyReferenceUrl(reference, index)))) {
    warnings.push("本地参考图不能直接用于 MJ URL 参数；请先上传到 Midjourney 或 Discord 后替换占位 URL。");
  }

  if (input.renderQuality !== "sd" && isAspectRatioWiderThan(input.aspectRatio, 4)) {
    warnings.push("V8.1 HD 模式不适合超过 4:1 的超宽比例，已按当前可选比例保留。");
  }

  return warnings;
}

function getMidjourneyReferenceUrl(
  reference: AssistantPromptReference,
  index: number
): string {
  const candidates = [reference.sourceImageUrl, reference.imageUrl]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  const publicUrl = candidates.find((value) => /^https?:\/\//i.test(value));

  return publicUrl ?? `<image-${index + 1}-url>`;
}

function extractMidjourneyNoParameter(prompt: string): string {
  const match = /\s--no\s+([\s\S]*?)(?=\s--[a-z]|\s*$)/i.exec(prompt);
  return match?.[1]?.trim() ?? "";
}

function normalizeMidjourneyNegativePrompt(value: string | undefined): string {
  return (value ?? "")
    .replace(/^--no\s+/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.;，。]+$/g, "");
}

function splitPromptClauses(value: string): string[] {
  return value
    .split(/[,，;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizePromptClauseForComparison(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function readNegativePromptItems(value: string | undefined): string[] {
  const normalized = normalizeMidjourneyNegativePrompt(value);

  if (!normalized) {
    return [];
  }

  return normalized
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function getDefaultMidjourneyStylize(input: AssistantPromptInput): number {
  const aspectRatio = normalizeAssistantAspectRatio(input.aspectRatio) ?? "16:9";

  if (input.renderQuality === "sd") {
    return 150;
  }

  if (aspectRatio === "4:5") {
    return 80;
  }

  if (aspectRatio === "21:9") {
    return 150;
  }

  return 120;
}

function normalizeInteger(
  value: number | undefined,
  fallback: number,
  min = 0,
  max = Number.MAX_SAFE_INTEGER
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.round(value)));
}

function mergeUniqueStrings(left: string[], right: string[]): string[] {
  return [...new Set([...left, ...right].map((item) => item.trim()).filter(Boolean))];
}

function isMidjourneyPlaceholderUrl(value: string): boolean {
  return /^<image-\d+-url>$/.test(value);
}

function isAspectRatioWiderThan(value: AssistantAspectRatio, limit: number): boolean {
  const normalized = normalizeAssistantAspectRatio(value);

  if (!normalized) {
    return false;
  }

  const [width, height] = normalized.split(":").map(Number);

  if (!width || !height) {
    return false;
  }

  return Math.max(width / height, height / width) > limit;
}

async function requestAssistantPromptResult(
  config: OpenAiGatewayConfig,
  messages: ChatMessage[],
  options: {
    signal?: AbortSignal;
    onProgress?: (event: ApiProgressEvent) => void;
  }
): Promise<AssistantPromptResult> {
  const primaryBody = createRequestBody(config, messages, true);

  try {
    return await executeAssistantPromptRequest(config, primaryBody, {
      ...options,
      usedJsonMode: true
    });
  } catch (error) {
    if (!shouldFallbackWithoutJsonMode(error)) {
      throw error;
    }

    options.onProgress?.({
      phase: "json_mode_fallback",
      message: "JSON mode is not supported by this gateway or model. Retrying with prompt-only JSON constraints."
    });

    const fallbackBody = createRequestBody(config, messages, false);

    return executeAssistantPromptRequest(config, fallbackBody, {
      ...options,
      usedJsonMode: false
    });
  }
}

async function executeAssistantPromptRequest(
  config: OpenAiGatewayConfig,
  body: ChatCompletionRequest,
  options: {
    signal?: AbortSignal;
    onProgress?: (event: ApiProgressEvent) => void;
    usedJsonMode: boolean;
  }
): Promise<AssistantPromptResult> {
  const response = await fetchChatCompletion(config, body, {
    signal: options.signal,
    onProgress: options.onProgress,
    phase: "analyzing"
  });
  const rawText = extractAssistantText(response);

  options.onProgress?.({ phase: "parsing", message: "Parsing assistant JSON" });

  return normalizeAssistantPromptResult(parseJsonObject(rawText));
}

function normalizeAssistantPromptResult(value: unknown): AssistantPromptResult {
  if (!isRecord(value)) {
    return {
      brief: "",
      finalPrompt: typeof value === "string" ? value : "",
      questions: [],
      assumptions: [],
      negativeConstraints: []
    };
  }

  const chineseCheck = normalizeAssistantChineseCheck(
    value.chineseCheck ??
      value.chinese_check ??
      value.chineseReview ??
      value.chinese_review
  );

  return {
    brief: readFirstString(value, ["brief", "chineseBrief", "summary"]),
    finalPrompt: readFirstString(value, [
      "finalPrompt",
      "final_prompt",
      "prompt",
      "englishPrompt"
    ]),
    questions: readStringArray(value.questions),
    assumptions: readStringArray(value.assumptions),
    negativeConstraints: readStringArray(
      value.negativeConstraints ?? value.negative_constraints
    ),
    ...(chineseCheck ? { chineseCheck } : {})
  };
}

function normalizeAssistantChineseCheck(
  value: unknown
): AssistantChineseCheck | undefined {
  if (typeof value === "string" && value.trim()) {
    return {
      backTranslation: value.trim(),
      checklist: [],
      possibleIssues: []
    };
  }

  if (!isRecord(value)) {
    return undefined;
  }

  const backTranslation = readFirstString(value, [
    "backTranslation",
    "back_translation",
    "translation",
    "semanticBackTranslation",
    "summary"
  ]);
  const checklist = readStringArray(value.checklist ?? value.checkList);
  const possibleIssues = readStringArray(
    value.possibleIssues ?? value.possible_issues ?? value.issues
  );

  if (!backTranslation && !checklist.length && !possibleIssues.length) {
    return undefined;
  }

  return {
    backTranslation,
    checklist,
    possibleIssues
  };
}

function readFirstString(
  value: Record<string, unknown>,
  keys: string[]
): string {
  for (const key of keys) {
    const candidate = value[key];

    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return "";
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

async function requestPromptDocument(
  config: OpenAiGatewayConfig,
  messages: ChatMessage[],
  options: {
    signal?: AbortSignal;
    onProgress?: (event: ApiProgressEvent) => void;
    phase: ApiTaskPhase;
    template?: PromptTemplate;
    normalizeOptions?: NormalizePromptDocumentOptions;
  }
): Promise<PromptDocumentResult> {
  const primaryBody = createRequestBody(config, messages, true);

  try {
    return await executePromptDocumentRequest(config, primaryBody, {
      ...options,
      usedJsonMode: true
    });
  } catch (error) {
    if (!shouldFallbackWithoutJsonMode(error)) {
      throw error;
    }

    options.onProgress?.({
      phase: "json_mode_fallback",
      message: "JSON mode is not supported by this gateway or model. Retrying with prompt-only JSON constraints."
    });

    const fallbackBody = createRequestBody(config, messages, false);

    return executePromptDocumentRequest(config, fallbackBody, {
      ...options,
      usedJsonMode: false
    });
  }
}

async function executePromptDocumentRequest(
  config: OpenAiGatewayConfig,
  body: ChatCompletionRequest,
  options: {
    signal?: AbortSignal;
    onProgress?: (event: ApiProgressEvent) => void;
    phase: ApiTaskPhase;
    usedJsonMode: boolean;
    template?: PromptTemplate;
    normalizeOptions?: NormalizePromptDocumentOptions;
  }
): Promise<PromptDocumentResult> {
  const response = await fetchChatCompletion(config, body, options);
  const rawText = extractAssistantText(response);

  options.onProgress?.({ phase: "parsing", message: "Parsing model JSON" });

  const parsed = parseJsonObject(rawText);
  const document = normalizeModelOutput(parsed, {
    template: options.template,
    normalizeOptions: options.normalizeOptions
  });

  return {
    document,
    rawText,
    usedJsonMode: options.usedJsonMode
  };
}

function createAnalyzeSystemPrompt(
  template: PromptTemplate | undefined,
  fallback: string
): string {
  if (!template) {
    return fallback;
  }

  return [
    template.systemPrompt,
    "",
    "【扩展输出约定】",
    "请严格遵守当前模板要求输出，不要强行改写成 PromptDocument。",
    "不要输出 version、generated_at、template、source、metadata、confidence、contributions 等插件内部字段，除非当前模板明确要求。",
    "不要把 base64 图片内容写入 JSON。",
    "输出会被插件保存为 template_output，后续可继续被自然语言编辑。"
  ].join("\n");
}

function createEditSystemPrompt(template: PromptTemplate | undefined): string {
  if (!template) {
    return EDIT_SYSTEM_PROMPT;
  }

  return [
    "你是一个专业的 AI 图像提示词编辑器。",
    "用户会提供当前模板生成的 JSON 结果和自然语言修改指令。",
    "请根据指令修改 JSON 中所有相关内容，并返回修改后的合法 JSON。",
    "如果用户要求替换品牌、物品、材质、风格、场景或细节，请同步更新所有相关字段，避免只改一个局部字段。",
    "不要输出 PromptDocument 包装结构，不要输出 version、generated_at、template、source、metadata、confidence、contributions 等插件内部字段。",
    "必须只返回一个合法 JSON 对象，不要返回 Markdown、解释文字或代码块。",
    "",
    "【当前模板】",
    `模板名称：${template.name}`,
    `模板描述：${template.description}`,
    "模板 system prompt：",
    template.systemPrompt
  ].join("\n");
}

function createEditUserContent(input: EditPromptInput): ChatContent {
  const currentJson =
    input.document.template_output !== undefined
      ? input.document.template_output
      : input.document;
  const referenceGuide = input.visualReferences?.length
    ? [
        "",
        "视觉参考顺序：",
        ...input.visualReferences.map((reference, index) => {
          const label = reference.label || `@图片${index + 1}`;
          const title = reference.sourceTitle?.trim();
          return title ? `${label}：${title}` : `${label}：第 ${index + 1} 张视觉参考图`;
        }),
        "如果修改指令出现 @图片1、@图片2 等引用，请严格按以上顺序理解对应图片。"
      ].join("\n")
    : "";
  const textPart = [
    input.document.template_output !== undefined
      ? "当前模板输出 JSON："
      : "当前 PromptDocument：",
    JSON.stringify(currentJson, null, 2),
    "",
    input.visualReferences?.length
      ? "本次编辑模式：视觉参考。请结合原图视觉信息与 JSON 内容进行修改。"
      : "本次编辑模式：文本编辑。请只根据 JSON 内容和修改指令进行概念替换。",
    referenceGuide,
    "",
    "【编辑边界】",
    "请严格按用户指令中的编辑边界执行。没有被用户文字明确点名、没有被快捷意图允许修改的字段必须保持不变。",
    "尤其不要擅自改变主体身份、光影、构图、镜头、色彩、风格、场景和材质。",
    input.visualReferences?.length
      ? "多图视觉参考只作为被 @图片 明确指定的角色使用，不得自动混合不同参考图的身份、场景、光影或风格。"
      : "文本编辑不得凭空重写无关字段。",
    "输出 JSON 必须同步更新所有相关字段，但不要重写无关字段。",
    "",
    "修改指令：",
    input.instruction
  ].join("\n");

  if (!input.visualReferences?.length) {
    return textPart;
  }

  return [
    {
      type: "text",
      text: textPart
    },
    ...input.visualReferences.map((reference) => ({
      type: "image_url" as const,
      image_url: {
        url: reference.imageUrl,
        detail: "high" as const
      }
    }))
  ];
}

function normalizeModelOutput(
  value: unknown,
  options: {
    template?: PromptTemplate;
    normalizeOptions?: NormalizePromptDocumentOptions;
  }
): PromptDocument {
  const templateMeta = options.template
    ? {
        id: options.template.id,
        name: options.template.name,
        icon: options.template.icon
      }
    : undefined;

  if (looksLikePromptDocument(value)) {
    return normalizePromptDocument(value, {
      ...options.normalizeOptions,
      template: templateMeta
    });
  }

  return normalizePromptDocument(
    {
      template: templateMeta,
      raw_prompt_text: createTemplateOutputText(value, options.template),
      negative_prompt: "",
      template_output: value,
      metadata: {
        model_suggestion: options.template?.name ?? "",
        complexity_score: 0
      }
    },
    {
      ...options.normalizeOptions,
      template: templateMeta,
      templateOutput: value
    }
  );
}

function createTemplateOutputText(value: unknown, template?: PromptTemplate): string {
  if (typeof value === "string") {
    return value;
  }

  const extractedPrompt = extractNaturalPromptFromTemplateOutput(value);

  if (extractedPrompt) {
    return extractedPrompt;
  }

  return flattenTemplateOutputAsPrompt(value) || `${template?.name ?? "模板"}输出已生成。`;
}

function extractNaturalPromptFromTemplateOutput(value: unknown): string | null {
  if (typeof value === "string") {
    return normalizePromptPreviewText(value);
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const extracted = extractNaturalPromptFromTemplateOutput(item);

      if (extracted) {
        return extracted;
      }
    }

    return null;
  }

  if (!isRecord(value)) {
    return null;
  }

  const preferredKeys = [
    "完整提示词",
    "完整中文提示词",
    "提示词",
    "正向提示词",
    "生成提示词",
    "生图提示词",
    "可直接使用的中文提示词",
    "可直接使用的提示词",
    "可复刻提示词",
    "可复制提示词",
    "中文提示词",
    "自然语言提示词",
    "prompt_text",
    "raw_prompt_text",
    "complete_prompt",
    "positive_prompt",
    "prompt"
  ];

  for (const key of preferredKeys) {
    const candidate = value[key];

    if (typeof candidate === "string") {
      const normalized = normalizePromptPreviewText(candidate);

      if (normalized) {
        return normalized;
      }
    }
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    if (isMetadataKey(key)) {
      continue;
    }

    const extracted = extractNaturalPromptFromTemplateOutput(nestedValue);

    if (extracted) {
      return extracted;
    }
  }

  return null;
}

function flattenTemplateOutputAsPrompt(value: unknown): string {
  const parts: string[] = [];
  collectPromptLeafText(value, parts);
  return normalizePromptPreviewText(parts.join("，")) ?? "";
}

function collectPromptLeafText(value: unknown, parts: string[], depth = 0): void {
  if (depth > 6 || parts.length >= 80) {
    return;
  }

  if (typeof value === "string") {
    const normalized = normalizePromptPreviewText(value);

    if (normalized && !isLowValuePromptText(normalized)) {
      parts.push(normalized);
    }

    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectPromptLeafText(item, parts, depth + 1);
    }

    return;
  }

  if (!isRecord(value)) {
    return;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    if (isMetadataKey(key)) {
      continue;
    }

    collectPromptLeafText(nestedValue, parts, depth + 1);
  }
}

function normalizePromptPreviewText(value: string): string | null {
  const normalized = value
    .replace(/\s+/g, " ")
    .replace(/^[{[\s]+|[}\]\s]+$/g, "")
    .trim();

  if (!normalized || normalized.length < 2) {
    return null;
  }

  return normalized;
}

function isMetadataKey(key: string): boolean {
  return [
    "id",
    "url",
    "source_url",
    "page_url",
    "thumbnail",
    "template",
    "source",
    "metadata",
    "generated_at",
    "version",
    "icon",
    "name"
  ].includes(key);
}

function isLowValuePromptText(value: string): boolean {
  return (
    value === "无明显体现" ||
    value === "无" ||
    value === "true" ||
    value === "false" ||
    /^upload:\/\//i.test(value) ||
    /^clipboard:\/\//i.test(value) ||
    /^https?:\/\//i.test(value)
  );
}

function looksLikePromptDocument(value: unknown): value is PromptDocument {
  return isRecord(value) && isRecord(value.prompt) && isRecord(value.source);
}

function readTemplateFromDocument(_document: PromptDocument): PromptTemplate | undefined {
  return undefined;
}

async function fetchChatCompletion(
  config: OpenAiGatewayConfig,
  body: ChatCompletionRequest,
  options: {
    signal?: AbortSignal;
    onProgress?: (event: ApiProgressEvent) => void;
    phase: ApiTaskPhase;
  }
): Promise<ChatCompletionResponse> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await fetchChatCompletionOnce(config, body, {
        signal: options.signal,
        phase: options.phase
      });
    } catch (error) {
      lastError = error;

      if (
        isAbortError(error) ||
        !isRetryableChatCompletionError(error) ||
        attempt === MAX_ATTEMPTS
      ) {
        break;
      }

      options.onProgress?.({
        phase: "retrying",
        attempt: attempt + 1,
        message: "Request failed. Retrying once after 3 seconds."
      });

      await delay(RETRY_DELAY_MS, options.signal);
    }
  }

  throw lastError;
}

async function fetchChatCompletionOnce(
  config: OpenAiGatewayConfig,
  body: ChatCompletionRequest,
  options: {
    signal?: AbortSignal;
    phase: ApiTaskPhase;
  }
): Promise<ChatCompletionResponse> {
  const endpoint = createChatCompletionsEndpoint(config.apiBaseUrl);
  const controller = new AbortController();
  let didTimeout = false;

  const timeoutId = globalThis.setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  const abortListener = () => {
    controller.abort();
  };

  options.signal?.addEventListener("abort", abortListener, { once: true });

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    const responseText = await response.text();

    if (!response.ok) {
      throw createAppError(
        "api_http_error",
        `API request failed with status ${response.status}.`,
        {
          status: response.status,
          responseText,
          phase: options.phase
        }
      );
    }

    try {
      return JSON.parse(responseText) as ChatCompletionResponse;
    } catch {
      throw createAppError(
        "api_response_error",
        "API returned a non-JSON response.",
        {
          responseText,
          phase: options.phase
        }
      );
    }
  } catch (error) {
    if (didTimeout) {
      throw createAppError(
        "request_timeout",
        "API request timed out after 60 seconds.",
        { phase: options.phase }
      );
    }

    if (controller.signal.aborted || options.signal?.aborted) {
      throw createAppError(
        "request_cancelled",
        "Request was cancelled.",
        { phase: options.phase }
      );
    }

    throw error;
  } finally {
    globalThis.clearTimeout(timeoutId);
    options.signal?.removeEventListener("abort", abortListener);
  }
}

function createRequestBody(
  config: OpenAiGatewayConfig,
  messages: ChatMessage[],
  useJsonMode: boolean
): ChatCompletionRequest {
  const body: ChatCompletionRequest = {
    model: config.model,
    messages,
    temperature: 0.2
  };

  if (useJsonMode) {
    body.response_format = { type: "json_object" };
  }

  return body;
}

function validateConfig(config: OpenAiGatewayConfig): void {
  if (!config.apiBaseUrl.trim()) {
    throw createAppError("missing_config", "API base URL is not configured.");
  }

  if (!config.apiKey.trim()) {
    throw createAppError("missing_config", "API key is not configured.");
  }

  if (!config.model.trim()) {
    throw createAppError("missing_config", "Model is not configured.");
  }
}

function extractAssistantText(response: ChatCompletionResponse): string {
  const firstChoice = response.choices?.[0];
  const content = firstChoice?.message?.content;

  if (typeof content === "string" && content.trim()) {
    return content.trim();
  }

  if (Array.isArray(content)) {
    const text = content
      .map((part) => part.text)
      .filter((value): value is string => Boolean(value))
      .join("\n")
      .trim();

    if (text) {
      return text;
    }
  }

  throw createAppError(
    "empty_model_response",
    "Model returned an empty response."
  );
}

function parseJsonObject(text: string): unknown {
  const candidates = [
    text,
    stripMarkdownFence(text),
    extractFirstJsonObject(text)
  ].filter((value): value is string => Boolean(value?.trim()));

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next tolerant parsing strategy.
    }
  }

  throw createAppError(
    "model_json_parse_error",
    "模型返回格式异常，请检查模型是否支持 JSON 模式。",
    { rawText: text }
  );
}

function stripMarkdownFence(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenceMatch?.[1]?.trim() ?? trimmed;
}

function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf("{");

  if (start < 0) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let isEscaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (isEscaped) {
        isEscaped = false;
      } else if (char === "\\") {
        isEscaped = true;
      } else if (char === "\"") {
        inString = false;
      }

      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;

      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  return null;
}

function shouldFallbackWithoutJsonMode(error: unknown): boolean {
  if (!isAppError(error)) {
    return false;
  }

  if (error.code !== "api_http_error") {
    return false;
  }

  const status = error.details.status;
  const responseText = String(error.details.responseText ?? "").toLowerCase();

  return (
    status === 400 ||
    status === 404 ||
    status === 422 ||
    responseText.includes("response_format") ||
    responseText.includes("json mode")
  );
}

function isRetryableChatCompletionError(error: unknown): boolean {
  if (!isAppError(error)) {
    return true;
  }

  if (error.code !== "api_http_error") {
    return true;
  }

  const status = error.details.status;

  if (typeof status !== "number") {
    return true;
  }

  if (status === 408 || status === 409 || status === 425 || status === 429) {
    return true;
  }

  return status >= 500;
}

function isAbortError(error: unknown): boolean {
  return (
    (isAppError(error) &&
      (error.code === "request_cancelled" || error.code === "request_timeout")) ||
    (error instanceof DOMException && error.name === "AbortError")
  );
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(
        createAppError("request_cancelled", "Request was cancelled during retry delay.")
      );
      return;
    }

    const timeoutId = globalThis.setTimeout(resolve, milliseconds);

    const abortListener = () => {
      globalThis.clearTimeout(timeoutId);
      reject(
        createAppError("request_cancelled", "Request was cancelled during retry delay.")
      );
    };

    signal?.addEventListener("abort", abortListener, { once: true });
  });
}

export function createChatCompletionsEndpoint(apiBaseUrl: string): string {
  const trimmed = apiBaseUrl.trim();

  if (!trimmed) {
    return CHAT_COMPLETIONS_PATH;
  }

  const url = new URL(trimmed);
  const pathname = url.pathname.replace(/\/+$/, "");

  if (/\/chat\/completions$/i.test(pathname)) {
    return url.toString();
  }

  const basePath = normalizeGatewayBasePath(url.hostname, pathname);
  url.pathname = `${basePath}${CHAT_COMPLETIONS_PATH}`.replace(/\/{2,}/g, "/");
  url.search = "";
  url.hash = "";

  return url.toString();
}

function normalizeGatewayBasePath(hostname: string, pathname: string): string {
  const normalizedHost = hostname.toLowerCase();

  if (normalizedHost === "ai.leihuo.netease.com") {
    // The Leihuo gateway endpoint shown in the console is /v1/chat/completions.
    // Users may still paste the product root as /api or /api/v1, so strip it.
    return pathname.replace(/\/api(?:\/v1)?$/i, "").replace(/\/v1$/i, "");
  }

  return pathname.replace(/\/v1$/i, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStringRecordValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readStringArrayRecordValue(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

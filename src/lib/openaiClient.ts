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

export type AssistantEngine = "nano-banana-pro" | "midjourney-v8.1";

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

export async function generateNanoBananaAssistantPrompt(
  config: OpenAiGatewayConfig,
  input: AssistantPromptInput
): Promise<AssistantPromptResult> {
  validateConfig(config);

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
    "4. Return JSON only. Use chineseCheck to explain the prompt and parameter choices in Chinese.",
    input.reverseContext
      ? "5. In chineseCheck, explicitly mention that the reverse-engineered JSON context was used for style, composition, camera, lighting, and color direction."
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
      readNegativePromptItems(input.negativePrompt)
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

      if (isAbortError(error) || attempt === MAX_ATTEMPTS) {
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

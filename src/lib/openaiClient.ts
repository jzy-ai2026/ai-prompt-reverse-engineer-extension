import { createAppError, isAppError } from "./errors";
import {
  normalizePromptDocument,
  type NormalizePromptDocumentOptions,
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

export interface AnalyzeImageInput {
  imageUrl: string;
  sourcePageUrl?: string;
  sourceTitle?: string;
  sourceImageUrl?: string;
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
  template?: PromptTemplate;
  signal?: AbortSignal;
  onProgress?: (event: ApiProgressEvent) => void;
}

export interface EditVisualReference {
  imageUrl: string;
  sourceImageUrl?: string;
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

type ChatRole = "system" | "user" | "assistant";

interface TextContentPart {
  type: "text";
  text: string;
}

interface ImageContentPart {
  type: "image_url";
  image_url: {
    url: string;
    detail?: "low" | "high" | "auto";
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

export async function analyzeImagePrompt(
  config: OpenAiGatewayConfig,
  input: AnalyzeImageInput
): Promise<PromptDocumentResult> {
  validateConfig(config);
  input.onProgress?.({ phase: "uploading", message: "Preparing image payload" });

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
            "source.type 使用 single。",
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
            detail: "high"
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
      sourceType: "single",
      sourceImageUrl: input.sourceImageUrl ?? input.imageUrl,
      sourcePageUrl: input.sourcePageUrl
    }
  });

  return result;
}

export async function analyzeImageMixPrompt(
  config: OpenAiGatewayConfig,
  input: AnalyzeImageMixInput
): Promise<PromptDocumentResult> {
  validateConfig(config);

  if (input.images.length < 2) {
    throw createAppError(
      "image_not_found",
      "混搭模式至少需要 2 张参考图。"
    );
  }

  const textParts = [
    "请综合这些参考图，反推出一个融合主体、风格、光影、色彩、构图和质感的混搭 Prompt，并输出 PromptDocument JSON。",
    "source.type 使用 mix。",
    "source.images 按输入顺序保留每张图片，id 使用 img_001、img_002 这样的格式。",
    "source.images[*].contributions 请写出该图主要贡献的字段，例如 subject、style、color。",
    "不要把 base64 图片内容写入 JSON。",
    "请用简体中文输出完整提示词，不要输出英文 Prompt。",
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
            detail: "high" as const
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
      sourceType: "mix",
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
  const textPart = [
    input.document.template_output !== undefined
      ? "当前模板输出 JSON："
      : "当前 PromptDocument：",
    JSON.stringify(currentJson, null, 2),
    "",
    input.visualReferences?.length
      ? "本次编辑模式：视觉参考。请结合原图视觉信息与 JSON 内容进行修改。"
      : "本次编辑模式：文本编辑。请只根据 JSON 内容和修改指令进行概念替换。",
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

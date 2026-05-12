export type PromptSourceType = "single" | "batch" | "style_common" | "mix";

export type PromptFieldKey =
  | "subject"
  | "style"
  | "lighting"
  | "color"
  | "composition"
  | "camera"
  | "mood"
  | "quality";

export interface SourceImage {
  id: string;
  url?: string;
  source_url?: string;
  page_url?: string;
  thumbnail?: string;
  contributions?: string[];
}

export interface PromptDocumentSource {
  type: PromptSourceType;
  images: SourceImage[];
}

export interface PromptField {
  description: string;
  confidence: number;
  tags?: string[];
  palette?: string[];
  type?: string;
  angle?: string;
  [key: string]: unknown;
}

export interface PromptDocument {
  version: string;
  generated_at: string;
  template?: {
    id: string;
    name: string;
    icon?: string;
  };
  source: PromptDocumentSource;
  prompt: Record<PromptFieldKey, PromptField>;
  raw_prompt_text: string;
  negative_prompt: string;
  template_output?: unknown;
  metadata: {
    model_suggestion?: string;
    complexity_score?: number;
    [key: string]: unknown;
  };
}

export interface NormalizePromptDocumentOptions {
  sourceType?: PromptSourceType;
  sourceImageUrl?: string;
  sourcePageUrl?: string;
  sourceImages?: SourceImage[];
  template?: PromptDocument["template"];
  templateOutput?: unknown;
}

export interface PromptSummary {
  title: string;
  subtitle: string;
}

const FIELD_KEYS: PromptFieldKey[] = [
  "subject",
  "style",
  "lighting",
  "color",
  "composition",
  "camera",
  "mood",
  "quality"
];

const FIELD_ALIASES: Record<string, PromptFieldKey> = {
  subject: "subject",
  主体: "subject",
  对象: "subject",
  人物: "subject",
  style: "style",
  风格: "style",
  画风: "style",
  lighting: "lighting",
  光影: "lighting",
  光线: "lighting",
  灯光: "lighting",
  color: "color",
  色调: "color",
  颜色: "color",
  配色: "color",
  composition: "composition",
  构图: "composition",
  视角: "composition",
  camera: "camera",
  镜头: "camera",
  运镜: "camera",
  mood: "mood",
  氛围: "mood",
  情绪: "mood",
  quality: "quality",
  质量: "quality",
  画质: "quality"
};

const DEFAULT_FIELD_DESCRIPTIONS: Record<PromptFieldKey, string> = {
  subject: "未识别主体",
  style: "未识别风格",
  lighting: "未识别光影",
  color: "未识别色调",
  composition: "未识别构图",
  camera: "未识别镜头",
  mood: "未识别氛围",
  quality: "高质量，细节丰富"
};

export function createEmptyPromptDocument(
  sourceType: PromptSourceType = "single"
): PromptDocument {
  const prompt = FIELD_KEYS.reduce((fields, key) => {
    fields[key] = createPromptField(DEFAULT_FIELD_DESCRIPTIONS[key], 0);
    return fields;
  }, {} as Record<PromptFieldKey, PromptField>);

  return {
    version: "1.0",
    generated_at: new Date().toISOString(),
    template: undefined,
    source: {
      type: sourceType,
      images: []
    },
    prompt,
    raw_prompt_text: "",
    negative_prompt: "",
    template_output: undefined,
    metadata: {
      model_suggestion: "",
      complexity_score: 0
    }
  };
}

export function normalizePromptDocument(
  value: unknown,
  options: NormalizePromptDocumentOptions = {}
): PromptDocument {
  const fallback = createEmptyPromptDocument(options.sourceType ?? "single");
  const input = isRecord(value) ? value : {};
  const promptInput = isRecord(input.prompt) ? input.prompt : {};

  const prompt = FIELD_KEYS.reduce((fields, key) => {
    fields[key] = normalizePromptField(promptInput[key], key);
    return fields;
  }, {} as Record<PromptFieldKey, PromptField>);

  const sourceInput = isRecord(input.source) ? input.source : {};
  const imagesInput = Array.isArray(sourceInput.images) ? sourceInput.images : [];
  let images = imagesInput
    .filter(isRecord)
    .map((image, index) => normalizeSourceImage(image, index));

  if (options.sourceImages?.length) {
    images = options.sourceImages.map((image, index) =>
      normalizeSourceImage(image as unknown as Record<string, unknown>, index)
    );
  }

  if (options.sourceImageUrl && images.length === 0) {
    images.push({
      id: "img_001",
      source_url: sanitizeStoredImageReference(options.sourceImageUrl),
      page_url: options.sourcePageUrl,
      contributions: FIELD_KEYS
    });
  }

  const document: PromptDocument = {
    version: readString(input.version, fallback.version),
    generated_at: readString(input.generated_at, new Date().toISOString()),
    template: normalizeTemplate(input.template, options.template),
    source: {
      type: readSourceType(sourceInput.type, options.sourceType ?? fallback.source.type),
      images
    },
    prompt,
    raw_prompt_text: readString(input.raw_prompt_text, ""),
    negative_prompt: readString(input.negative_prompt, ""),
    template_output:
      options.templateOutput !== undefined ? options.templateOutput : input.template_output,
    metadata: normalizeMetadata(input.metadata)
  };

  if (document.template_output !== undefined) {
    const templatePromptText = createTemplateOutputPromptText(
      document.template_output,
      document.template?.name
    );

    if (templatePromptText) {
      document.raw_prompt_text = templatePromptText;
    }
  }

  if (!document.raw_prompt_text.trim()) {
    document.raw_prompt_text = buildRawPromptText(document);
  }

  return document;
}

export function createPromptPreviewText(document: PromptDocument): string {
  if (document.template_output !== undefined) {
    const templatePromptText = createTemplateOutputPromptText(
      document.template_output
    );

    if (templatePromptText) {
      return templatePromptText;
    }
  }

  return document.raw_prompt_text || buildRawPromptText(document);
}

export function createTemplateOutputPromptText(
  value: unknown,
  _templateName?: string
): string {
  const extracted = extractNaturalPromptFromTemplateOutput(value);
  const promptText = extracted || flattenTemplateOutputAsPrompt(value);

  if (!promptText) {
    return "结构化结果已生成。";
  }

  return promptText;
}

export function createStructuredJsonText(document: PromptDocument): string {
  return JSON.stringify(createStructuredJsonValue(document), null, 2);
}

export function updatePromptDocumentFromStructuredJsonText(
  document: PromptDocument,
  jsonText: string
): PromptDocument {
  const parsed = JSON.parse(jsonText) as unknown;

  if (looksLikePromptDocument(parsed)) {
    return normalizePromptDocument(parsed);
  }

  const nextDocument = normalizePromptDocument({
    ...document,
    template_output: parsed,
    raw_prompt_text: createTemplateOutputPromptText(parsed),
    negative_prompt: extractNegativePromptFromTemplateOutput(parsed) ?? document.negative_prompt
  });

  return nextDocument;
}

function createStructuredJsonValue(document: PromptDocument): unknown {
  if (document.template_output !== undefined) {
    return document.template_output;
  }

  return {
    提示词: document.raw_prompt_text || buildRawPromptText(document),
    负面提示词: document.negative_prompt
  };
}

export function buildRawPromptText(document: PromptDocument): string {
  const parts = [
    document.prompt.subject.description,
    document.prompt.style.description,
    document.prompt.lighting.description,
    document.prompt.color.description,
    document.prompt.composition.description,
    document.prompt.camera.description,
    document.prompt.mood.description,
    document.prompt.quality.description
  ]
    .map((part) => part.trim())
    .filter(Boolean);

  return parts.join(", ");
}

export function createPromptSummary(document: PromptDocument): PromptSummary {
  if (document.template?.name && document.template_output !== undefined) {
    return {
      title: document.template.name,
      subtitle: document.raw_prompt_text.slice(0, 80)
    };
  }

  const subject = document.prompt.subject.description || "未命名 Prompt";
  const style = document.prompt.style.description;
  const color = document.prompt.color.description;

  return {
    title: subject,
    subtitle: [style, color].filter(Boolean).join(" / ")
  };
}

export function applyFieldAssignment(
  document: PromptDocument,
  instruction: string
): PromptDocument | null {
  const match = /^\s*([^=：:]+)\s*(?:=|：|:)\s*(.+?)\s*$/.exec(instruction);

  if (!match) {
    return null;
  }

  const rawPath = match[1]?.trim();
  const value = match[2]?.trim();

  if (!rawPath || !value) {
    return null;
  }

  const nextDocument = clonePromptDocument(document);
  const pathParts = rawPath.split(".").map((part) => part.trim()).filter(Boolean);
  const targetField = resolvePromptFieldKey(pathParts[0] ?? rawPath);

  if (!targetField) {
    return null;
  }

  if (pathParts.length <= 1) {
    nextDocument.prompt[targetField] = {
      ...nextDocument.prompt[targetField],
      description: value,
      confidence: Math.max(nextDocument.prompt[targetField].confidence, 0.9)
    };
  } else {
    const property = pathParts[1];

    if (!property) {
      return null;
    }

    nextDocument.prompt[targetField] = {
      ...nextDocument.prompt[targetField],
      [property]: parseAssignmentValue(value)
    };
  }

  nextDocument.raw_prompt_text = buildRawPromptText(nextDocument);
  nextDocument.generated_at = new Date().toISOString();

  return nextDocument;
}

export function resolvePromptFieldKey(value: string): PromptFieldKey | null {
  const normalized = value.trim().toLowerCase();
  return FIELD_ALIASES[normalized] ?? null;
}

export function clonePromptDocument(document: PromptDocument): PromptDocument {
  return JSON.parse(JSON.stringify(document)) as PromptDocument;
}

export function getPromptFieldKeys(): PromptFieldKey[] {
  return [...FIELD_KEYS];
}

export function createPromptField(
  description: string,
  confidence = 0.8
): PromptField {
  return {
    description,
    confidence: clampConfidence(confidence)
  };
}

function normalizePromptField(value: unknown, key: PromptFieldKey): PromptField {
  if (typeof value === "string") {
    return createPromptField(value, 0.8);
  }

  if (!isRecord(value)) {
    return createPromptField(DEFAULT_FIELD_DESCRIPTIONS[key], 0);
  }

  return {
    ...value,
    description: readString(value.description, DEFAULT_FIELD_DESCRIPTIONS[key]),
    confidence: clampConfidence(readNumber(value.confidence, 0.8))
  };
}

function normalizeSourceImage(value: Record<string, unknown>, index: number): SourceImage {
  const contributions = Array.isArray(value.contributions)
    ? value.contributions.filter((item): item is string => typeof item === "string")
    : undefined;

  return {
    id: readString(value.id, `img_${String(index + 1).padStart(3, "0")}`),
    url: sanitizeStoredImageReference(readOptionalString(value.url)),
    source_url: sanitizeStoredImageReference(readOptionalString(value.source_url)),
    page_url: readOptionalString(value.page_url),
    thumbnail: sanitizeStoredImageReference(readOptionalString(value.thumbnail)),
    contributions
  };
}

function sanitizeStoredImageReference(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();

  if (!trimmed || /^data:image\//i.test(trimmed)) {
    return undefined;
  }

  if (/^upload:\/\//i.test(trimmed)) {
    return "upload://image";
  }

  if (/^clipboard:\/\//i.test(trimmed)) {
    return "clipboard://image";
  }

  return trimmed.length > 2048 ? trimmed.slice(0, 2048) : trimmed;
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

function extractNegativePromptFromTemplateOutput(value: unknown): string | null {
  if (!isRecord(value)) {
    return null;
  }

  const preferredKeys = [
    "负面提示词",
    "负向提示词",
    "反向提示词",
    "negative_prompt",
    "negativePrompt"
  ];

  for (const key of preferredKeys) {
    const candidate = value[key];

    if (typeof candidate === "string") {
      return normalizePromptPreviewText(candidate) ?? "";
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

function looksLikePromptDocument(value: unknown): value is PromptDocument {
  return isRecord(value) && isRecord(value.prompt) && isRecord(value.source);
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

function normalizeMetadata(value: unknown): PromptDocument["metadata"] {
  if (!isRecord(value)) {
    return {};
  }

  return {
    ...value,
    model_suggestion: readOptionalString(value.model_suggestion),
    complexity_score:
      typeof value.complexity_score === "number"
        ? value.complexity_score
        : undefined
  };
}

function normalizeTemplate(
  value: unknown,
  fallback?: PromptDocument["template"]
): PromptDocument["template"] | undefined {
  const input = isRecord(value) ? value : {};
  const id = readOptionalString(input.id) ?? fallback?.id;
  const name = readOptionalString(input.name) ?? fallback?.name;

  if (!id || !name) {
    return fallback;
  }

  return {
    id,
    name,
    icon: readOptionalString(input.icon) ?? fallback?.icon
  };
}

function readSourceType(value: unknown, fallback: PromptSourceType): PromptSourceType {
  if (
    value === "single" ||
    value === "batch" ||
    value === "style_common" ||
    value === "mix"
  ) {
    return value;
  }

  return fallback;
}

function parseAssignmentValue(value: string): unknown {
  const trimmed = value.trim();

  if (trimmed === "true") {
    return true;
  }

  if (trimmed === "false") {
    return false;
  }

  const numberValue = Number(trimmed);

  if (Number.isFinite(numberValue) && trimmed !== "") {
    return numberValue;
  }

  if (
    (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
    (trimmed.startsWith("{") && trimmed.endsWith("}"))
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }

  if (trimmed.includes(",")) {
    return trimmed
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return trimmed;
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(1, value));
}

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === "number" ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

import {
  buildRawPromptText,
  createPromptSummary,
  normalizePromptDocument,
  type PromptDocument
} from "./promptDocument";
import {
  BUILT_IN_PROMPT_TEMPLATES,
  DEFAULT_PROMPT_TEMPLATE_ID,
  getDefaultPromptTemplate,
  isBuiltInPromptTemplateId,
  normalizePromptTemplate,
  type CustomPromptTemplateInput,
  type PromptTemplate
} from "./promptTemplates";
import type {
  AssistantPromptInput,
  AssistantPromptResult
} from "./openaiClient";

const SETTINGS_KEY = "settings";
const PRIVACY_CONSENT_KEY = "privacyConsent";
const HISTORY_KEY = "promptHistory";
const ASSISTANT_HISTORY_KEY = "assistantHistory";
const CUSTOM_PROMPT_TEMPLATES_KEY = "customPromptTemplates";
const MAX_HISTORY_ITEMS = 20;
const MAX_ASSISTANT_HISTORY_ITEMS = 20;
const MAX_HISTORY_REFERENCE_IMAGES = 6;
const MAX_HISTORY_INLINE_IMAGE_BYTES = 120_000;

export const DEFAULT_API_BASE_URL =
  import.meta.env.VITE_DEFAULT_API_BASE_URL ||
  "https://ai.leihuo.netease.com/v1";

export const DEFAULT_MODEL =
  import.meta.env.VITE_DEFAULT_MODEL || "gemini-3.1-pro-preview-customtools";

// Keep production bundles free of local development keys.
const DEV_DEFAULT_API_KEY = import.meta.env.DEV
  ? import.meta.env.VITE_DEFAULT_API_KEY || ""
  : "";

export interface ExtensionSettings {
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  modelPresets: string[];
  selectedPromptTemplateId: string;
}

export interface PrivacyConsent {
  remembered: boolean;
  granted: boolean;
  updatedAt?: string;
}

export interface PromptHistoryItem {
  id: string;
  createdAt: string;
  sourcePageUrl?: string;
  sourceTitle?: string;
  thumbnail?: string;
  referenceImages?: HistoryReferenceImage[];
  summaryTitle: string;
  summarySubtitle: string;
  rawPromptText: string;
  document: PromptDocument;
}

export type StoredAssistantPromptInput = Omit<
  AssistantPromptInput,
  "signal" | "onProgress"
>;

export interface AssistantHistoryItem {
  id: string;
  createdAt: string;
  summaryTitle: string;
  summarySubtitle: string;
  input: StoredAssistantPromptInput;
  result: AssistantPromptResult;
  referenceImages?: HistoryReferenceImage[];
}

export interface HistoryReferenceImage {
  id: string;
  url?: string;
  sourceImageUrl?: string;
  sourcePageUrl?: string;
  sourceTitle?: string;
  thumbnail?: string;
  width?: number;
  height?: number;
}

export const DEFAULT_MODEL_PRESETS = [
  "gemini-3.1-pro-preview-customtools",
  "gpt-4o",
  "gpt-4.1",
  "claude-sonnet-4",
  "claude-3-5-sonnet"
];

export function getDefaultSettings(): ExtensionSettings {
  return {
    apiBaseUrl: DEFAULT_API_BASE_URL,
    apiKey: DEV_DEFAULT_API_KEY,
    model: DEFAULT_MODEL,
    modelPresets: DEFAULT_MODEL_PRESETS,
    selectedPromptTemplateId: DEFAULT_PROMPT_TEMPLATE_ID
  };
}

export async function getSettings(): Promise<ExtensionSettings> {
  const stored = await storageGet<{ [SETTINGS_KEY]?: Partial<ExtensionSettings> }>(
    SETTINGS_KEY
  );
  const defaults = getDefaultSettings();
  const settings = stored[SETTINGS_KEY] ?? {};

  return {
    apiBaseUrl: normalizeApiBaseUrl(
      readString(settings.apiBaseUrl, defaults.apiBaseUrl)
    ),
    apiKey: readString(settings.apiKey, defaults.apiKey),
    model: readString(settings.model, defaults.model),
    modelPresets: Array.isArray(settings.modelPresets)
      ? settings.modelPresets.filter((item): item is string => typeof item === "string")
      : defaults.modelPresets,
    selectedPromptTemplateId: readString(
      settings.selectedPromptTemplateId,
      defaults.selectedPromptTemplateId
    )
  };
}

export async function saveSettings(
  updates: Partial<ExtensionSettings>
): Promise<ExtensionSettings> {
  const current = await getSettings();
  const next: ExtensionSettings = {
    ...current,
    ...updates,
    apiBaseUrl: normalizeApiBaseUrl(updates.apiBaseUrl ?? current.apiBaseUrl),
    apiKey: updates.apiKey ?? current.apiKey,
    model: updates.model ?? current.model,
    modelPresets: normalizeModelPresets(
      updates.modelPresets ?? current.modelPresets,
      updates.model ?? current.model
    ),
    selectedPromptTemplateId:
      updates.selectedPromptTemplateId ?? current.selectedPromptTemplateId
  };

  await storageSet({ [SETTINGS_KEY]: next });
  return next;
}

export async function getPrivacyConsent(): Promise<PrivacyConsent> {
  const stored = await storageGet<{ [PRIVACY_CONSENT_KEY]?: Partial<PrivacyConsent> }>(
    PRIVACY_CONSENT_KEY
  );
  const consent = stored[PRIVACY_CONSENT_KEY] ?? {};

  return {
    remembered: Boolean(consent.remembered),
    granted: Boolean(consent.granted),
    updatedAt: readOptionalString(consent.updatedAt)
  };
}

export async function savePrivacyConsent(
  consent: PrivacyConsent
): Promise<PrivacyConsent> {
  const next = {
    ...consent,
    updatedAt: new Date().toISOString()
  };

  await storageSet({ [PRIVACY_CONSENT_KEY]: next });
  return next;
}

export async function clearPrivacyConsent(): Promise<void> {
  await storageRemove(PRIVACY_CONSENT_KEY);
}

export async function getHistory(): Promise<PromptHistoryItem[]> {
  const stored = await storageGet<{ [HISTORY_KEY]?: unknown[] }>(HISTORY_KEY);
  const history = stored[HISTORY_KEY] ?? [];
  const normalizedHistory = history
    .filter(isPromptHistoryItem)
    .slice(0, MAX_HISTORY_ITEMS)
    .map(normalizeHistoryItem);

  if (
    history.length !== normalizedHistory.length ||
    containsInlineImageDataUrl(history)
  ) {
    await storageSet({ [HISTORY_KEY]: normalizedHistory });
  }

  return normalizedHistory;
}

export async function addHistoryItem(input: {
  document: PromptDocument;
  sourcePageUrl?: string;
  sourceTitle?: string;
  thumbnail?: string;
  referenceImages?: HistoryReferenceImage[];
}): Promise<PromptHistoryItem[]> {
  const document = normalizePromptDocument(input.document);
  const summary = createPromptSummary(document);
  const existing = await getHistory();
  const referenceImages = normalizeHistoryReferenceImages(
    input.referenceImages ?? createReferenceImagesFromDocument(document, input)
  );
  const thumbnail =
    sanitizeHistoryImageReference(input.thumbnail) ??
    referenceImages[0]?.thumbnail ??
    referenceImages[0]?.url;

  const item: PromptHistoryItem = {
    id: createHistoryId(),
    createdAt: new Date().toISOString(),
    sourcePageUrl: input.sourcePageUrl,
    sourceTitle: input.sourceTitle,
    thumbnail,
    referenceImages,
    summaryTitle: summary.title,
    summarySubtitle: summary.subtitle,
    rawPromptText: document.raw_prompt_text || buildRawPromptText(document),
    document
  };

  const next = [item, ...existing].slice(0, MAX_HISTORY_ITEMS);
  await storageSet({ [HISTORY_KEY]: next });
  return next;
}

export async function removeHistoryItem(id: string): Promise<PromptHistoryItem[]> {
  const existing = await getHistory();
  const next = existing.filter((item) => item.id !== id);
  await storageSet({ [HISTORY_KEY]: next });
  return next;
}

export async function clearHistory(): Promise<void> {
  await storageSet({ [HISTORY_KEY]: [] });
}

export async function getAssistantHistory(): Promise<AssistantHistoryItem[]> {
  const stored = await storageGet<{ [ASSISTANT_HISTORY_KEY]?: unknown[] }>(
    ASSISTANT_HISTORY_KEY
  );
  const history = stored[ASSISTANT_HISTORY_KEY] ?? [];
  const normalizedHistory = history
    .filter(isAssistantHistoryItem)
    .slice(0, MAX_ASSISTANT_HISTORY_ITEMS)
    .map(normalizeAssistantHistoryItem);

  if (
    history.length !== normalizedHistory.length ||
    containsInlineImageDataUrl(history)
  ) {
    await storageSet({ [ASSISTANT_HISTORY_KEY]: normalizedHistory });
  }

  return normalizedHistory;
}

export async function addAssistantHistoryItem(input: {
  input: StoredAssistantPromptInput;
  result: AssistantPromptResult;
  referenceImages?: HistoryReferenceImage[];
}): Promise<AssistantHistoryItem[]> {
  const existing = await getAssistantHistory();
  const referenceImages = normalizeHistoryReferenceImages(input.referenceImages ?? []);
  const normalizedInput = normalizeStoredAssistantInput(input.input, referenceImages);
  const result = normalizeStoredAssistantResult(input.result);
  const summary = createAssistantHistorySummary(normalizedInput, result);
  const item: AssistantHistoryItem = {
    id: createHistoryId(),
    createdAt: new Date().toISOString(),
    summaryTitle: summary.title,
    summarySubtitle: summary.subtitle,
    input: normalizedInput,
    result,
    referenceImages
  };

  const next = [item, ...existing].slice(0, MAX_ASSISTANT_HISTORY_ITEMS);
  await storageSet({ [ASSISTANT_HISTORY_KEY]: next });
  return next;
}

export async function removeAssistantHistoryItem(
  id: string
): Promise<AssistantHistoryItem[]> {
  const existing = await getAssistantHistory();
  const next = existing.filter((item) => item.id !== id);
  await storageSet({ [ASSISTANT_HISTORY_KEY]: next });
  return next;
}

export async function clearAssistantHistory(): Promise<void> {
  await storageSet({ [ASSISTANT_HISTORY_KEY]: [] });
}

export async function getPromptTemplates(): Promise<PromptTemplate[]> {
  const stored = await storageGet<{
    [CUSTOM_PROMPT_TEMPLATES_KEY]?: unknown[];
  }>(CUSTOM_PROMPT_TEMPLATES_KEY);
  const customTemplates = (stored[CUSTOM_PROMPT_TEMPLATES_KEY] ?? [])
    .map((item) => normalizePromptTemplate(item))
    .filter((template): template is PromptTemplate => Boolean(template))
    .filter((template) => !isBuiltInPromptTemplateId(template.id))
    .map((template) => ({ ...template, kind: "custom" as const }));

  return [...BUILT_IN_PROMPT_TEMPLATES, ...customTemplates];
}

export async function getSelectedPromptTemplate(): Promise<PromptTemplate> {
  const settings = await getSettings();
  const templates = await getPromptTemplates();

  return (
    templates.find((template) => template.id === settings.selectedPromptTemplateId) ??
    getDefaultPromptTemplate()
  );
}

export async function saveCustomPromptTemplate(
  input: CustomPromptTemplateInput
): Promise<PromptTemplate[]> {
  const current = await getPromptTemplates();
  const custom = current.filter((template) => template.kind === "custom");
  const normalized = normalizePromptTemplate({
    ...input,
    id:
      input.id && !isBuiltInPromptTemplateId(input.id)
        ? input.id
        : createCustomTemplateId(),
    kind: "custom"
  });

  if (!normalized) {
    return current;
  }

  const nextCustom = [
    normalized,
    ...custom.filter((template) => template.id !== normalized.id)
  ];

  await storageSet({ [CUSTOM_PROMPT_TEMPLATES_KEY]: nextCustom });
  return [...BUILT_IN_PROMPT_TEMPLATES, ...nextCustom];
}

export async function duplicatePromptTemplate(id: string): Promise<PromptTemplate[]> {
  const templates = await getPromptTemplates();
  const source = templates.find((template) => template.id === id);

  if (!source) {
    return templates;
  }

  return saveCustomPromptTemplate({
    ...source,
    id: createCustomTemplateId(),
    name: `${source.name} 副本`,
    kind: "custom"
  });
}

export async function deleteCustomPromptTemplate(id: string): Promise<PromptTemplate[]> {
  if (isBuiltInPromptTemplateId(id)) {
    return getPromptTemplates();
  }

  const templates = await getPromptTemplates();
  const nextCustom = templates.filter(
    (template) => template.kind === "custom" && template.id !== id
  );

  await storageSet({ [CUSTOM_PROMPT_TEMPLATES_KEY]: nextCustom });

  const settings = await getSettings();
  if (settings.selectedPromptTemplateId === id) {
    await saveSettings({ selectedPromptTemplateId: DEFAULT_PROMPT_TEMPLATE_ID });
  }

  return [...BUILT_IN_PROMPT_TEMPLATES, ...nextCustom];
}

function normalizeApiBaseUrl(value: string): string {
  const trimmed = value.trim();

  if (!trimmed) {
    return DEFAULT_API_BASE_URL;
  }

  try {
    const url = new URL(trimmed);

    if (
      url.hostname === "ai.leihuo.netease.com" &&
      /\/api(?:\/v1)?\/?$/i.test(url.pathname)
    ) {
      url.pathname = "/v1";
      url.search = "";
      url.hash = "";
      return url.toString().replace(/\/+$/, "");
    }
  } catch {
    return trimmed.replace(/\/+$/, "");
  }

  return trimmed.replace(/\/+$/, "");
}

function normalizeModelPresets(values: string[], selectedModel: string): string[] {
  const unique = new Set(
    [...DEFAULT_MODEL_PRESETS, ...values, selectedModel]
      .map((value) => value.trim())
      .filter(Boolean)
  );

  return [...unique];
}

function createHistoryId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `hist_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function createCustomTemplateId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `custom_${crypto.randomUUID()}`;
  }

  return `custom_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function isPromptHistoryItem(value: unknown): value is PromptHistoryItem {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.summaryTitle === "string" &&
    typeof value.rawPromptText === "string" &&
    isRecord(value.document)
  );
}

function normalizeHistoryItem(item: PromptHistoryItem): PromptHistoryItem {
  const document = normalizePromptDocument(item.document);
  const summary = createPromptSummary(document);
  const referenceImages = normalizeHistoryReferenceImages(
    item.referenceImages ?? createReferenceImagesFromDocument(document, item)
  );
  const thumbnail =
    sanitizeHistoryImageReference(item.thumbnail) ??
    referenceImages[0]?.thumbnail ??
    referenceImages[0]?.url;

  return {
    ...item,
    thumbnail,
    referenceImages,
    summaryTitle: item.summaryTitle || summary.title,
    summarySubtitle: item.summarySubtitle || summary.subtitle,
    rawPromptText: document.raw_prompt_text || buildRawPromptText(document),
    document
  };
}

function isAssistantHistoryItem(value: unknown): value is AssistantHistoryItem {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.createdAt === "string" &&
    isRecord(value.input) &&
    isRecord(value.result)
  );
}

function normalizeAssistantHistoryItem(
  item: AssistantHistoryItem
): AssistantHistoryItem {
  const referenceImages = normalizeHistoryReferenceImages(item.referenceImages ?? []);
  const input = normalizeStoredAssistantInput(item.input, referenceImages);
  const result = normalizeStoredAssistantResult(item.result);
  const summary = createAssistantHistorySummary(input, result);

  return {
    ...item,
    summaryTitle: item.summaryTitle || summary.title,
    summarySubtitle: item.summarySubtitle || summary.subtitle,
    input,
    result,
    referenceImages
  };
}

function normalizeStoredAssistantInput(
  input: unknown,
  referenceImages: HistoryReferenceImage[]
): StoredAssistantPromptInput {
  const record = isRecord(input) ? input : {};
  const references = Array.isArray(record.references) ? record.references : [];

  return {
    mode: readAssistantMode(record.mode),
    idea: readString(record.idea, ""),
    references: references
      .filter(isRecord)
      .slice(0, MAX_HISTORY_REFERENCE_IMAGES)
      .map((reference, index) => {
        const fallback = referenceImages[index];
        const imageUrl =
          sanitizeHistoryImageReference(readOptionalString(reference.imageUrl)) ??
          fallback?.thumbnail ??
          fallback?.url;
        const sourceImageUrl =
          sanitizeStoredSourceReference(readOptionalString(reference.sourceImageUrl)) ??
          fallback?.sourceImageUrl;

        return {
          role: readAssistantReferenceRole(reference.role),
          label:
            readOptionalString(reference.label) ??
            fallback?.id ??
            `Image ${index + 1}`,
          imageUrl,
          sourceImageUrl,
          sourcePageUrl:
            readOptionalString(reference.sourcePageUrl) ?? fallback?.sourcePageUrl,
          sourceTitle:
            readOptionalString(reference.sourceTitle) ?? fallback?.sourceTitle
        };
      }),
    aspectRatio: readAssistantAspectRatio(record.aspectRatio),
    resolution: readAssistantResolution(record.resolution),
    identityLock: Boolean(record.identityLock),
    extraSpecs: readOptionalString(record.extraSpecs)
  };
}

function normalizeStoredAssistantResult(value: unknown): AssistantPromptResult {
  const record = isRecord(value) ? value : {};

  return {
    brief: readString(record.brief, ""),
    finalPrompt: readString(record.finalPrompt, ""),
    questions: readOptionalStringArray(record.questions),
    assumptions: readOptionalStringArray(record.assumptions),
    negativeConstraints: readOptionalStringArray(
      record.negativeConstraints ?? record.negative_constraints
    )
  };
}

function createAssistantHistorySummary(
  input: StoredAssistantPromptInput,
  result: AssistantPromptResult
): { title: string; subtitle: string } {
  const title = truncateText(
    result.brief || input.idea || "Nano Banana Pro 提示词",
    42
  );
  const referenceCount = input.references.length;
  const modeLabel = input.mode === "editing" ? "改图" : "生图";
  const subtitle = `${modeLabel} · ${input.aspectRatio} · ${input.resolution}${
    referenceCount ? ` · ${referenceCount} 图` : ""
  }`;

  return { title, subtitle };
}

function readAssistantMode(value: unknown): StoredAssistantPromptInput["mode"] {
  return isOneOf(value, ["auto", "text-to-image", "image-and-text", "editing"])
    ? value
    : "auto";
}

function readAssistantReferenceRole(
  value: unknown
): StoredAssistantPromptInput["references"][number]["role"] {
  return isOneOf(value, [
    "identity",
    "style",
    "composition",
    "scene",
    "product",
    "text",
    "material"
  ])
    ? value
    : "style";
}

function readAssistantAspectRatio(
  value: unknown
): StoredAssistantPromptInput["aspectRatio"] {
  return isOneOf(value, [
    "1:1",
    "2:3",
    "3:2",
    "3:4",
    "4:3",
    "4:5",
    "5:4",
    "9:16",
    "16:9",
    "21:9"
  ])
    ? value
    : "16:9";
}

function readAssistantResolution(
  value: unknown
): StoredAssistantPromptInput["resolution"] {
  return isOneOf(value, ["1K", "2K", "4K"]) ? value : "2K";
}

function readOptionalStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function truncateText(value: string, maxLength: number): string {
  const trimmed = value.replace(/\s+/g, " ").trim();

  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return `${trimmed.slice(0, maxLength - 1)}…`;
}

function isOneOf<const T extends readonly string[]>(
  value: unknown,
  allowed: T
): value is T[number] {
  return typeof value === "string" && allowed.includes(value);
}

function createReferenceImagesFromDocument(
  document: PromptDocument,
  fallback: {
    sourcePageUrl?: string;
    sourceTitle?: string;
    thumbnail?: string;
  }
): HistoryReferenceImage[] {
  const images = document.source.images.length
    ? document.source.images
    : [
        {
          id: "img_001",
          source_url: fallback.thumbnail,
          page_url: fallback.sourcePageUrl,
          thumbnail: fallback.thumbnail
        }
      ];

  return images.slice(0, MAX_HISTORY_REFERENCE_IMAGES).map((image, index) => ({
    id: image.id || `img_${String(index + 1).padStart(3, "0")}`,
    url: image.url ?? image.thumbnail ?? image.source_url,
    sourceImageUrl: image.source_url ?? image.url,
    sourcePageUrl: image.page_url ?? fallback.sourcePageUrl,
    sourceTitle: fallback.sourceTitle,
    thumbnail: image.thumbnail ?? image.url ?? image.source_url
  }));
}

function normalizeHistoryReferenceImages(
  images: unknown[]
): HistoryReferenceImage[] {
  return images
    .filter((image) => isRecord(image))
    .slice(0, MAX_HISTORY_REFERENCE_IMAGES)
    .map((image, index) => ({
      id: readString(image.id, `img_${String(index + 1).padStart(3, "0")}`),
      url: sanitizeHistoryImageReference(readOptionalString(image.url)),
      sourceImageUrl: sanitizeStoredSourceReference(
        readOptionalString(image.sourceImageUrl)
      ),
      sourcePageUrl: readOptionalString(image.sourcePageUrl),
      sourceTitle: readOptionalString(image.sourceTitle),
      thumbnail: sanitizeHistoryImageReference(
        readOptionalString(image.thumbnail) ?? readOptionalString(image.url)
      ),
      width: readOptionalNumber(image.width),
      height: readOptionalNumber(image.height)
    }))
    .filter((image) => Boolean(image.url || image.thumbnail || image.sourceImageUrl));
}

function sanitizeHistoryImageReference(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return undefined;
  }

  if (/^data:image\//i.test(trimmed)) {
    return estimateDataUrlBytes(trimmed) <= MAX_HISTORY_INLINE_IMAGE_BYTES
      ? trimmed
      : undefined;
  }

  if (/^(https?:|upload:\/\/|clipboard:\/\/)/i.test(trimmed)) {
    return trimmed.length > 2048 && /^https?:/i.test(trimmed)
      ? trimmed.slice(0, 2048)
      : trimmed;
  }

  return undefined;
}

function sanitizeStoredSourceReference(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();

  if (!trimmed || /^data:image\//i.test(trimmed)) {
    return undefined;
  }

  return trimmed.length > 2048 && /^https?:/i.test(trimmed)
    ? trimmed.slice(0, 2048)
    : trimmed;
}

function estimateDataUrlBytes(dataUrl: string): number {
  const base64 = dataUrl.split(",", 2)[1] ?? "";
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

function containsInlineImageDataUrl(value: unknown, depth = 0): boolean {
  if (depth > 8) {
    return false;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    return (
      /^data:image\//i.test(trimmed) &&
      estimateDataUrlBytes(trimmed) > MAX_HISTORY_INLINE_IMAGE_BYTES
    );
  }

  if (Array.isArray(value)) {
    return value.some((item) => containsInlineImageDataUrl(item, depth + 1));
  }

  if (isRecord(value)) {
    return Object.values(value).some((item) =>
      containsInlineImageDataUrl(item, depth + 1)
    );
  }

  return false;
}

function storageGet<T extends Record<string, unknown>>(
  keys: string | string[]
): Promise<T> {
  if (!hasExtensionStorage()) {
    return Promise.resolve({} as T);
  }

  return chrome.storage.local.get(keys) as Promise<T>;
}

function storageSet(values: Record<string, unknown>): Promise<void> {
  if (!hasExtensionStorage()) {
    return Promise.resolve();
  }

  return chrome.storage.local.set(values);
}

function storageRemove(keys: string | string[]): Promise<void> {
  if (!hasExtensionStorage()) {
    return Promise.resolve();
  }

  return chrome.storage.local.remove(keys);
}

function hasExtensionStorage(): boolean {
  return typeof chrome !== "undefined" && Boolean(chrome.storage?.local);
}

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

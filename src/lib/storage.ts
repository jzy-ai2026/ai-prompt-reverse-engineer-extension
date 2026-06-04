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
  AssistantColorRecipe,
  AssistantColorRecipeKey,
  AssistantCompositionRecipe,
  AssistantCompositionRecipeKey,
  AssistantEngine,
  AssistantAspectRatio,
  AssistantLightingRecipe,
  AssistantLightingRecipeKey,
  AssistantPromptInput,
  AssistantRecipeSource,
  AssistantPromptResult,
  AssistantReverseContext,
  AssistantRenderQuality,
  GptImage2DebugInfo,
  GptImage2GameGenre,
  GptImage2GameUseCase,
  GptImage2LayoutType,
  GptImage2OptimizeStrength,
  GptImage2ReferenceMode,
  GptImage2TaskMode,
  GptImage2TextPolicy
} from "./openaiClient";
import { normalizeAssistantAspectRatio } from "./openaiClient";

const SETTINGS_KEY = "settings";
const PRIVACY_CONSENT_KEY = "privacyConsent";
const HISTORY_KEY = "promptHistory";
const ASSISTANT_HISTORY_KEY = "assistantHistory";
const ASSISTANT_FAVORITES_KEY = "assistantFavorites";
const CUSTOM_PROMPT_TEMPLATES_KEY = "customPromptTemplates";
const MAX_HISTORY_ITEMS = 20;
const MAX_ASSISTANT_HISTORY_ITEMS = 20;
const MAX_ASSISTANT_FAVORITE_ITEMS = 100;
const MAX_HISTORY_REFERENCE_IMAGES = 6;
const MAX_HISTORY_INLINE_IMAGE_BYTES = 120_000;
export const DEFAULT_MAX_CONCURRENT_TASKS = 2;
export const MIN_MAX_CONCURRENT_TASKS = 1;
export const MAX_MAX_CONCURRENT_TASKS = 4;
const LIGHTING_RECIPE_KEYS: AssistantLightingRecipeKey[] = [
  "shadowShapes",
  "shadowTargets",
  "shadowEdges",
  "contrast",
  "shadowSources",
  "fillLights"
];
const COMPOSITION_RECIPE_KEYS: AssistantCompositionRecipeKey[] = [
  "shotSize",
  "cameraAngle",
  "lens",
  "structure",
  "focalHierarchy",
  "artistLogic"
];
const COLOR_RECIPE_KEYS: AssistantColorRecipeKey[] = [
  "dominantPalette",
  "shadowColor",
  "highlightColor",
  "accentColor",
  "saturationContrast",
  "grading"
];

export const DEFAULT_API_BASE_URL =
  import.meta.env.VITE_DEFAULT_API_BASE_URL ||
  "https://ai.leihuo.netease.com/v1";

export const DEFAULT_MODEL =
  import.meta.env.VITE_DEFAULT_MODEL || "gemini-3.1-pro-preview-customtools";

export const DEFAULT_PHOTOSHOP_BRIDGE_URL =
  import.meta.env.VITE_DEFAULT_PHOTOSHOP_BRIDGE_URL ||
  "http://127.0.0.1:8787";

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
  photoshopBridgeUrl: string;
  maxConcurrentTasks: number;
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

export interface AssistantFavoriteItem {
  id: string;
  createdAt: string;
  updatedAt: string;
  name: string;
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
  "gpt-5.5",
  "nanobanana2",
  "nanobananapro",
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
    selectedPromptTemplateId: DEFAULT_PROMPT_TEMPLATE_ID,
    photoshopBridgeUrl: DEFAULT_PHOTOSHOP_BRIDGE_URL,
    maxConcurrentTasks: DEFAULT_MAX_CONCURRENT_TASKS
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
    modelPresets: normalizeModelPresets(
      Array.isArray(settings.modelPresets)
        ? settings.modelPresets.filter((item): item is string => typeof item === "string")
        : defaults.modelPresets,
      readString(settings.model, defaults.model)
    ),
    selectedPromptTemplateId: readString(
      settings.selectedPromptTemplateId,
      defaults.selectedPromptTemplateId
    ),
    photoshopBridgeUrl: normalizePhotoshopBridgeUrl(
      readString(settings.photoshopBridgeUrl, defaults.photoshopBridgeUrl)
    ),
    maxConcurrentTasks: normalizeMaxConcurrentTasks(
      settings.maxConcurrentTasks,
      defaults.maxConcurrentTasks
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
      updates.selectedPromptTemplateId ?? current.selectedPromptTemplateId,
    photoshopBridgeUrl: normalizePhotoshopBridgeUrl(
      updates.photoshopBridgeUrl ?? current.photoshopBridgeUrl
    ),
    maxConcurrentTasks: normalizeMaxConcurrentTasks(
      updates.maxConcurrentTasks ?? current.maxConcurrentTasks,
      current.maxConcurrentTasks
    )
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

export async function getAssistantFavorites(): Promise<AssistantFavoriteItem[]> {
  const stored = await storageGet<{ [ASSISTANT_FAVORITES_KEY]?: unknown[] }>(
    ASSISTANT_FAVORITES_KEY
  );
  const favorites = stored[ASSISTANT_FAVORITES_KEY] ?? [];
  const normalizedFavorites = favorites
    .filter(isAssistantFavoriteItem)
    .slice(0, MAX_ASSISTANT_FAVORITE_ITEMS)
    .map(normalizeAssistantFavoriteItem);

  if (
    favorites.length !== normalizedFavorites.length ||
    containsInlineImageDataUrl(favorites)
  ) {
    await storageSet({ [ASSISTANT_FAVORITES_KEY]: normalizedFavorites });
  }

  return normalizedFavorites;
}

export async function addAssistantFavoriteItem(input: {
  name?: string;
  input: StoredAssistantPromptInput;
  result: AssistantPromptResult;
  referenceImages?: HistoryReferenceImage[];
}): Promise<AssistantFavoriteItem[]> {
  const existing = await getAssistantFavorites();
  const referenceImages = normalizeHistoryReferenceImages(input.referenceImages ?? []);
  const normalizedInput = normalizeStoredAssistantInput(input.input, referenceImages);
  const result = normalizeStoredAssistantResult(input.result);
  const summary = createAssistantHistorySummary(normalizedInput, result);
  const favoriteKey = createAssistantFavoriteKey(normalizedInput, result);
  const previous = existing.find(
    (item) => createAssistantFavoriteKey(item.input, item.result) === favoriteKey
  );
  const now = new Date().toISOString();
  const name =
    truncateText(
      input.name?.trim() ||
        previous?.name ||
        result.brief ||
        summary.title ||
        "收藏提示词",
      64
    ) || "收藏提示词";
  const item: AssistantFavoriteItem = {
    id: previous?.id ?? createHistoryId(),
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
    name,
    summaryTitle: summary.title,
    summarySubtitle: summary.subtitle,
    input: normalizedInput,
    result,
    referenceImages
  };
  const next = [
    item,
    ...existing.filter(
      (current) =>
        createAssistantFavoriteKey(current.input, current.result) !== favoriteKey
    )
  ].slice(0, MAX_ASSISTANT_FAVORITE_ITEMS);

  await storageSet({ [ASSISTANT_FAVORITES_KEY]: next });
  return next;
}

export async function removeAssistantFavoriteItem(
  id: string
): Promise<AssistantFavoriteItem[]> {
  const existing = await getAssistantFavorites();
  const next = existing.filter((item) => item.id !== id);
  await storageSet({ [ASSISTANT_FAVORITES_KEY]: next });
  return next;
}

export async function clearAssistantFavorites(): Promise<void> {
  await storageSet({ [ASSISTANT_FAVORITES_KEY]: [] });
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

function normalizePhotoshopBridgeUrl(value: string): string {
  const trimmed = value.trim() || DEFAULT_PHOTOSHOP_BRIDGE_URL;

  try {
    const url = new URL(trimmed);
    url.pathname = url.pathname.replace(/\/+$/, "");
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return trimmed.replace(/\/+$/, "");
  }
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

function isAssistantFavoriteItem(value: unknown): value is AssistantFavoriteItem {
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

function normalizeAssistantFavoriteItem(
  item: AssistantFavoriteItem
): AssistantFavoriteItem {
  const referenceImages = normalizeHistoryReferenceImages(item.referenceImages ?? []);
  const input = normalizeStoredAssistantInput(item.input, referenceImages);
  const result = normalizeStoredAssistantResult(item.result);
  const summary = createAssistantHistorySummary(input, result);

  return {
    ...item,
    updatedAt: readOptionalString(item.updatedAt) ?? item.createdAt,
    name: truncateText(item.name || result.brief || summary.title, 64) || "收藏提示词",
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
    engine: readAssistantEngine(record.engine),
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
    reverseContext: normalizeStoredAssistantReverseContext(record.reverseContext),
    extraSpecs: readOptionalString(record.extraSpecs),
    rawEnabled:
      typeof record.rawEnabled === "boolean" ? record.rawEnabled : undefined,
    renderQuality: readAssistantRenderQuality(record.renderQuality),
    stylize: readOptionalNumber(record.stylize),
    chaos: readOptionalNumber(record.chaos),
    weird: readOptionalNumber(record.weird),
    seed: readOptionalString(record.seed),
    negativePrompt: readOptionalString(record.negativePrompt),
    personalizationCode: readOptionalString(record.personalizationCode),
    compositionRecipe: normalizeStoredAssistantCompositionRecipe(
      record.compositionRecipe
    ),
    compositionRecipeEnabled:
      typeof record.compositionRecipeEnabled === "boolean"
        ? record.compositionRecipeEnabled
        : undefined,
    autoCompositionEnabled:
      typeof record.autoCompositionEnabled === "boolean"
        ? record.autoCompositionEnabled
        : undefined,
    compositionSource:
      readAssistantRecipeSource(record.compositionSource) ??
      (record.compositionRecipe ? "manual" : undefined),
    lightingRecipe: normalizeStoredAssistantLightingRecipe(record.lightingRecipe),
    lightingRecipeEnabled:
      typeof record.lightingRecipeEnabled === "boolean"
        ? record.lightingRecipeEnabled
        : undefined,
    autoLightingEnabled:
      typeof record.autoLightingEnabled === "boolean"
        ? record.autoLightingEnabled
        : undefined,
    lightingSource:
      readAssistantRecipeSource(record.lightingSource) ??
      (record.lightingRecipe ? "manual" : undefined),
    colorRecipe: normalizeStoredAssistantColorRecipe(record.colorRecipe),
    colorRecipeEnabled:
      typeof record.colorRecipeEnabled === "boolean"
        ? record.colorRecipeEnabled
        : undefined,
    autoColorEnabled:
      typeof record.autoColorEnabled === "boolean"
        ? record.autoColorEnabled
        : undefined,
    colorSource:
      readAssistantRecipeSource(record.colorSource) ??
      (record.colorRecipe ? "manual" : undefined),
    gptImage2: normalizeStoredGptImage2Options(record.gptImage2)
  };
}

function normalizeStoredGptImage2Options(
  value: unknown
): StoredAssistantPromptInput["gptImage2"] {
  if (!isRecord(value)) {
    return undefined;
  }

  return {
    taskMode: readGptImage2TaskMode(value.taskMode),
    referenceMode: readGptImage2ReferenceMode(value.referenceMode),
    targetAspectRatio: readGptImage2TargetAspectRatio(value.targetAspectRatio),
    layoutType: readGptImage2LayoutType(value.layoutType),
    optimizeStrength: readGptImage2OptimizeStrength(value.optimizeStrength),
    textPolicy: readGptImage2TextPolicy(value.textPolicy),
    exactText: readOptionalString(value.exactText),
    seed:
      typeof value.seed === "number" && Number.isInteger(value.seed) && value.seed > 0
        ? value.seed
        : undefined,
    gameModeEnabled: typeof value.gameModeEnabled === "boolean"
      ? value.gameModeEnabled
      : false,
    gameUseCase: readGptImage2GameUseCase(value.gameUseCase),
    gameGenre: readGptImage2GameGenre(value.gameGenre)
  };
}

function normalizeStoredAssistantCompositionRecipe(
  value: unknown
): AssistantCompositionRecipe | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const promptText = readOptionalString(value.promptText);

  if (!promptText) {
    return undefined;
  }

  return {
    name: readOptionalString(value.name) ?? "自定义构图",
    promptText,
    negativePrompt: readOptionalString(value.negativePrompt),
    presetId: readOptionalString(value.presetId),
    customText: readOptionalString(value.customText),
    selectedKeywords: normalizeStoredRecipeKeywords(
      value.selectedKeywords,
      COMPOSITION_RECIPE_KEYS
    )
  };
}

function normalizeStoredAssistantLightingRecipe(
  value: unknown
): AssistantLightingRecipe | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const promptText = readOptionalString(value.promptText);

  if (!promptText) {
    return undefined;
  }

  const name = readOptionalString(value.name) ?? "自定义光影";

  return {
    name,
    promptText,
    negativePrompt: readOptionalString(value.negativePrompt),
    presetId: readOptionalString(value.presetId),
    customText: readOptionalString(value.customText),
    selectedKeywords: normalizeStoredLightingKeywords(value.selectedKeywords)
  };
}

function normalizeStoredLightingKeywords(
  value: unknown
): AssistantLightingRecipe["selectedKeywords"] {
  return normalizeStoredRecipeKeywords(value, LIGHTING_RECIPE_KEYS);
}

function normalizeStoredAssistantColorRecipe(
  value: unknown
): AssistantColorRecipe | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const promptText = readOptionalString(value.promptText);

  if (!promptText) {
    return undefined;
  }

  return {
    name: readOptionalString(value.name) ?? "自定义配色",
    promptText,
    negativePrompt: readOptionalString(value.negativePrompt),
    presetId: readOptionalString(value.presetId),
    customText: readOptionalString(value.customText),
    selectedKeywords: normalizeStoredRecipeKeywords(
      value.selectedKeywords,
      COLOR_RECIPE_KEYS
    )
  };
}

function normalizeStoredRecipeKeywords<K extends string>(
  value: unknown,
  keys: K[]
): Partial<Record<K, string[]>> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const entries = keys.map((key) => {
    const values = readOptionalStringArray(value[key]);

    return values.length ? [key, values] : undefined;
  }).filter((entry): entry is [K, string[]] =>
    Boolean(entry)
  );

  return entries.length
    ? Object.fromEntries(entries) as Partial<Record<K, string[]>>
    : undefined;
}

function normalizeStoredAssistantReverseContext(
  value: unknown
): AssistantReverseContext | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const promptText = readOptionalString(value.promptText);
  const structuredJson = readOptionalString(value.structuredJson);

  if (!promptText && !structuredJson) {
    return undefined;
  }

  return {
    sourceType: readAssistantReverseSourceType(value.sourceType),
    templateName: readOptionalString(value.templateName),
    promptText: promptText ?? "",
    negativePrompt: readOptionalString(value.negativePrompt),
    structuredJson: structuredJson ?? "",
    fields: normalizeStoredAssistantReverseFields(value.fields)
  };
}

function normalizeStoredAssistantReverseFields(
  value: unknown
): AssistantReverseContext["fields"] {
  if (!isRecord(value)) {
    return {};
  }

  return Object.fromEntries(
    [
      "subject",
      "style",
      "lighting",
      "color",
      "composition",
      "camera",
      "mood",
      "quality"
    ]
      .map((key) => [key, readOptionalString(value[key])] as const)
      .filter((entry): entry is readonly [string, string] => Boolean(entry[1]))
  ) as AssistantReverseContext["fields"];
}

function normalizeStoredAssistantResult(value: unknown): AssistantPromptResult {
  const record = isRecord(value) ? value : {};
  const chineseCheck = normalizeStoredAssistantChineseCheck(
    record.chineseCheck ??
      record.chinese_check ??
      record.chineseReview ??
      record.chinese_review
  );
  const debugInfo = normalizeStoredGptImage2DebugInfo(
    record.debugInfo ?? record.debug_info
  );

  return {
    brief: readString(record.brief, ""),
    finalPrompt: readString(record.finalPrompt, ""),
    questions: readOptionalStringArray(record.questions),
    assumptions: readOptionalStringArray(record.assumptions),
    negativeConstraints: readOptionalStringArray(
      record.negativeConstraints ?? record.negative_constraints
    ),
    ...(chineseCheck ? { chineseCheck } : {}),
    ...(debugInfo ? { debugInfo } : {})
  };
}

function normalizeStoredAssistantChineseCheck(
  value: unknown
): AssistantPromptResult["chineseCheck"] {
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

  const backTranslation =
    readOptionalString(
      value.backTranslation ??
        value.back_translation ??
        value.translation ??
        value.summary
    ) ?? "";
  const checklist = readOptionalStringArray(value.checklist ?? value.checkList);
  const possibleIssues = readOptionalStringArray(
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

function normalizeStoredGptImage2DebugInfo(
  value: unknown
): GptImage2DebugInfo | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const input = isRecord(value.input) ? value.input : {};
  const finalPrompt = readString(value.final_prompt, "");
  const referenceSummary = readString(value.reference_summary, "");

  if (!finalPrompt && !referenceSummary && !value.raw_output) {
    return undefined;
  }

  return {
    input: {
      task_mode: readGptImage2TaskMode(input.task_mode),
      reference_mode:
        readGptImage2ReferenceMode(input.reference_mode) ?? "auto",
      layout_type: readGptImage2LayoutType(input.layout_type),
      optimize_strength: readGptImage2OptimizeStrength(input.optimize_strength),
      text_policy: readGptImage2TextPolicy(input.text_policy),
      target_aspect_ratio: readString(
        input.target_aspect_ratio,
        readString(input.aspect_ratio, "16:9")
      ),
      aspect_ratio: readString(input.aspect_ratio, "16:9"),
      direction: readString(input.direction, "横版构图"),
      has_exact_text: Boolean(input.has_exact_text),
      subject_image_count: readOptionalNumber(input.subject_image_count) ?? 0,
      reference_image_count: readOptionalNumber(input.reference_image_count) ?? 0,
      format_warnings: readOptionalStringArray(input.format_warnings),
      game_mode_enabled: Boolean(input.game_mode_enabled),
      game_use_case: readGptImage2GameUseCase(input.game_use_case),
      game_genre: readGptImage2GameGenre(input.game_genre),
      game_prompt_guidance: readOptionalStringArray(input.game_prompt_guidance),
      audit_warnings: readOptionalStringArray(input.audit_warnings),
      seed:
        typeof input.seed === "number" && Number.isInteger(input.seed) && input.seed > 0
          ? input.seed
          : undefined,
      model: readOptionalString(input.model)
    },
    image_mapping: normalizeStoredGptImage2ImageMapping(value.image_mapping),
    parse_status: value.parse_status === "fallback" ? "fallback" : "parsed",
    raw_output: readString(value.raw_output, ""),
    final_prompt: finalPrompt,
    reference_summary: referenceSummary,
    schema_result: isRecord(value.schema_result) ? value.schema_result : undefined,
    renderer_input: isRecord(value.renderer_input)
      ? value.renderer_input
      : undefined
  };
}

function normalizeStoredGptImage2ImageMapping(
  value: unknown
): GptImage2DebugInfo["image_mapping"] {
  const record = isRecord(value) ? value : {};

  return {
    subject_images: normalizeStoredGptImage2DebugItems(record.subject_images),
    reference_images: normalizeStoredGptImage2DebugItems(record.reference_images),
    style_images: normalizeStoredGptImage2DebugItems(record.style_images),
    composition_images: normalizeStoredGptImage2DebugItems(
      record.composition_images
    ),
    color_lighting_images: normalizeStoredGptImage2DebugItems(
      record.color_lighting_images
    ),
    layout_images: normalizeStoredGptImage2DebugItems(record.layout_images)
  };
}

function normalizeStoredGptImage2DebugItems(
  value: unknown
): GptImage2DebugInfo["image_mapping"]["subject_images"] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isRecord).map((item) => ({
    label: readString(item.label, ""),
    role: readAssistantReferenceRole(item.role),
    sourceTitle: readOptionalString(item.sourceTitle)
  }));
}

function createAssistantHistorySummary(
  input: StoredAssistantPromptInput,
  result: AssistantPromptResult
): { title: string; subtitle: string } {
  const title = truncateText(
    result.brief ||
      input.idea ||
      (input.engine === "midjourney-v8.1"
        ? "Midjourney V8.1 提示词"
        : input.engine === "gpt-image-2"
          ? "GPT-Image-2 提示词"
          : "Nano Banana Pro 提示词"),
    42
  );
  const referenceCount = input.references.length;
  const modeLabel =
    input.engine === "gpt-image-2"
      ? "优化"
      : input.mode === "editing" ? "改图" : "生图";
  const engineLabel =
    input.engine === "midjourney-v8.1"
      ? "MJ V8.1"
      : input.engine === "gpt-image-2"
        ? "GPT-Image-2"
        : "Nano Banana Pro";
  const qualityLabel =
    input.engine === "midjourney-v8.1"
      ? (input.renderQuality ?? "hd").toUpperCase()
      : input.engine === "gpt-image-2"
        ? input.gptImage2?.taskMode === "draft"
          ? input.gptImage2?.layoutType ?? "draft"
          : input.gptImage2?.referenceMode ?? "auto"
        : input.resolution;
  const aspectLabel =
    input.engine === "gpt-image-2"
      ? input.gptImage2?.targetAspectRatio ?? input.aspectRatio
      : input.aspectRatio;
  const subtitle = `${engineLabel} · ${modeLabel} · ${aspectLabel} · ${qualityLabel}${
    referenceCount ? ` · ${referenceCount} 图` : ""
  }`;

  return { title, subtitle };
}

function createAssistantFavoriteKey(
  input: StoredAssistantPromptInput,
  result: AssistantPromptResult
): string {
  return `${input.engine}\n${result.finalPrompt.replace(/\s+/g, " ").trim()}`;
}

function readAssistantEngine(value: unknown): AssistantEngine {
  return isOneOf(value, ["nano-banana-pro", "midjourney-v8.1", "gpt-image-2"])
    ? value
    : "nano-banana-pro";
}

function readGptImage2ReferenceMode(
  value: unknown
): GptImage2ReferenceMode | undefined {
  return isOneOf(value, [
    "auto",
    "full_reference",
    "style_only",
    "composition_only",
    "color_lighting_only",
    "layout_only"
  ])
    ? value
    : undefined;
}

function readGptImage2TaskMode(value: unknown): GptImage2TaskMode {
  return isOneOf(value, ["draft", "reference"]) ? value : "reference";
}

function readGptImage2LayoutType(value: unknown): GptImage2LayoutType {
  return isOneOf(value, [
    "auto",
    "pure_visual",
    "poster",
    "ecommerce",
    "social_cover",
    "ui_mockup",
    "game_visual"
  ])
    ? value
    : "auto";
}

function readGptImage2OptimizeStrength(
  value: unknown
): GptImage2OptimizeStrength {
  return isOneOf(value, ["standard", "enhanced"]) ? value : "standard";
}

function readGptImage2TextPolicy(value: unknown): GptImage2TextPolicy {
  return isOneOf(value, ["none", "preserve", "enhance", "generate"])
    ? value
    : "preserve";
}

function readGptImage2GameUseCase(value: unknown): GptImage2GameUseCase {
  return isOneOf(value, [
    "none",
    "ingame_screenshot",
    "environment_concept",
    "character_concept",
    "boss_arena",
    "asset_breakdown",
    "ui_screenshot"
  ])
    ? value
    : "none";
}

function readGptImage2GameGenre(value: unknown): GptImage2GameGenre {
  return isOneOf(value, [
    "auto",
    "wuxia",
    "fantasy",
    "sci_fi",
    "realistic",
    "stylized"
  ])
    ? value
    : "auto";
}

function readGptImage2TargetAspectRatio(
  value: unknown
): "auto" | AssistantAspectRatio | undefined {
  if (value === "auto") {
    return "auto";
  }

  return normalizeAssistantAspectRatio(value);
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
  return normalizeAssistantAspectRatio(value) ?? "16:9";
}

function readAssistantResolution(
  value: unknown
): StoredAssistantPromptInput["resolution"] {
  return isOneOf(value, ["1K", "2K", "4K"]) ? value : "2K";
}

function readAssistantReverseSourceType(
  value: unknown
): AssistantReverseContext["sourceType"] {
  return isOneOf(value, ["single", "batch", "style_common", "mix"])
    ? value
    : "single";
}

function readAssistantRenderQuality(
  value: unknown
): AssistantRenderQuality | undefined {
  return isOneOf(value, ["sd", "hd"]) ? value : undefined;
}

function readAssistantRecipeSource(
  value: unknown
): AssistantRecipeSource | undefined {
  return isOneOf(value, ["auto", "manual"]) ? value : undefined;
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

function normalizeMaxConcurrentTasks(
  value: unknown,
  fallback = DEFAULT_MAX_CONCURRENT_TASKS
): number {
  const numericValue =
    typeof value === "number" && Number.isFinite(value)
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : fallback;
  const integerValue = Math.round(Number.isFinite(numericValue) ? numericValue : fallback);

  return Math.min(
    MAX_MAX_CONCURRENT_TASKS,
    Math.max(MIN_MAX_CONCURRENT_TASKS, integerValue)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

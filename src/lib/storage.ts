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

const SETTINGS_KEY = "settings";
const PRIVACY_CONSENT_KEY = "privacyConsent";
const HISTORY_KEY = "promptHistory";
const CUSTOM_PROMPT_TEMPLATES_KEY = "customPromptTemplates";
const MAX_HISTORY_ITEMS = 20;

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
  summaryTitle: string;
  summarySubtitle: string;
  rawPromptText: string;
  document: PromptDocument;
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
}): Promise<PromptHistoryItem[]> {
  const document = normalizePromptDocument(input.document);
  const summary = createPromptSummary(document);
  const existing = await getHistory();

  const item: PromptHistoryItem = {
    id: createHistoryId(),
    createdAt: new Date().toISOString(),
    sourcePageUrl: input.sourcePageUrl,
    sourceTitle: input.sourceTitle,
    thumbnail: input.thumbnail,
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

  return {
    ...item,
    summaryTitle: item.summaryTitle || summary.title,
    summarySubtitle: item.summarySubtitle || summary.subtitle,
    rawPromptText: document.raw_prompt_text || buildRawPromptText(document),
    document
  };
}

function containsInlineImageDataUrl(value: unknown, depth = 0): boolean {
  if (depth > 8) {
    return false;
  }

  if (typeof value === "string") {
    return /^data:image\//i.test(value.trim());
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

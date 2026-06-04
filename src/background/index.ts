import { createAppError, serializeError, toUserFacingError } from "../lib/errors";
import {
  createImageThumbnailDataUrl,
  FAST_VISION_IMAGE_LONG_EDGE,
  FAST_VISION_JPEG_QUALITY,
  FAST_VISION_MAX_DATA_URL_BYTES,
  prepareImageForVision,
  type ImagePipelineProgress,
  type PreparedImagePayload
} from "../lib/imagePipeline";
import {
  analyzeImageStyleCommonPrompt,
  analyzeImagePrompt,
  editPromptDocument,
  generateAssistantPromptWithGateway,
  type ApiProgressEvent,
  type AssistantPromptInput,
  type AssistantPromptResult
} from "../lib/openaiClient";
import type { PromptDocument } from "../lib/promptDocument";
import {
  getBuiltInPromptTemplate,
  getDefaultPromptTemplate
} from "../lib/promptTemplates";
import {
  addHistoryItem,
  addAssistantHistoryItem,
  addAssistantFavoriteItem,
  clearAssistantHistory,
  clearAssistantFavorites,
  getPrivacyConsent,
  getAssistantHistory,
  getAssistantFavorites,
  getSelectedPromptTemplate,
  getSettings,
  removeAssistantHistoryItem,
  removeAssistantFavoriteItem,
  saveSettings,
  savePrivacyConsent,
  type AssistantFavoriteItem,
  type AssistantHistoryItem,
  type HistoryReferenceImage,
  type PromptHistoryItem
} from "../lib/storage";

const MENU_ANALYZE_IMAGE = "prompt-reverse:analyze-image";
const MENU_ADD_TO_MIX = "prompt-reverse:add-to-mix";
const MENU_COPY_TAB_TO_WORKSPACE = "prompt-reverse:copy-tab-to-workspace";
const CONSENT_TIMEOUT_MS = 5 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 15_000;
const PANEL_SURFACE_HEARTBEAT_TTL_MS = 12_000;
const MAX_MIX_IMAGES = 6;
const MIX_IMAGES_KEY = "mixImages";
const WORKSPACE_SESSION_KEY = "promptReverseWorkspaces";
const DEFAULT_WORKSPACE_ID = "workspace_default";
const POPUP_WIDTH = 520;
const POPUP_HEIGHT = 760;
const POPUP_BASE_LEFT = 120;
const POPUP_BASE_TOP = 80;
const POPUP_OFFSET_STEP = 28;
const POPUP_OFFSET_LIMIT = 7;

type TaskStatus =
  | "idle"
  | "queued"
  | "awaiting_consent"
  | "preparing"
  | "running"
  | "done"
  | "error"
  | "cancelled";

type TaskKind = "analyze" | "edit" | "assistant";
type MultiAnalyzeMode = "style_common" | "batch";
type TaskMode = "single" | MultiAnalyzeMode;
type TaskTimingStatus = "done" | "error";
type PanelSurface = "sidepanel" | "floating" | "popup";

interface CapturedImage {
  url: string;
  sourcePageUrl?: string;
  sourceTitle?: string;
  tabId?: number;
}

interface TaskState {
  id: string;
  workspaceId: string;
  kind: TaskKind;
  status: TaskStatus;
  phase?: string;
  message?: string;
  mode?: TaskMode;
  queuePosition?: number;
  createdAt: string;
  updatedAt: string;
  source?: CapturedImage;
  sources?: CapturedImage[];
  preparedImage?: PreparedImagePayload;
  preparedImages?: PreparedImagePayload[];
  referenceImages?: HistoryReferenceImage[];
  document?: PromptDocument;
  rawText?: string;
  usedJsonMode?: boolean;
  historySaved?: boolean;
  input?: unknown;
  assistantResult?: AssistantPromptResult;
  timings?: TaskTimingEntry[];
  progressPercent?: number;
  progressLabel?: string;
  progressDetail?: string;
  error?: ReturnType<typeof toUserFacingError>;
}

interface WorkspaceState {
  id: string;
  title: string;
  surface: PanelSurface;
  windowId?: number;
  mixImages: CapturedImage[];
  activeTaskId?: string;
  lastResultTaskId?: string;
  createdAt: string;
  updatedAt: string;
}

interface WorkspaceResponse {
  workspace: WorkspaceState;
  task: TaskState | null;
}

interface TaskTimingEntry {
  id: string;
  label: string;
  durationMs: number;
  startedAt: string;
  endedAt: string;
  status: TaskTimingStatus;
  detail?: string;
}

interface EditVisualReference {
  imageUrl: string;
  sourceImageUrl?: string;
  label?: string;
  sourceTitle?: string;
}

interface RuntimeResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: ReturnType<typeof serializeError>;
}

type RuntimeRequest = { workspaceId?: string } & (
  | { type: "panel:create-workspace"; surface?: PanelSurface; title?: string }
  | { type: "panel:get-workspace-state"; surface?: PanelSurface; windowId?: number }
  | { type: "panel:update-workspace-draft"; title?: string; mixImages?: CapturedImage[] }
  | { type: "panel:detach-workspace" }
  | { type: "panel:copy-current-tab" }
  | { type: "panel:set-max-concurrency"; maxConcurrentTasks: number }
  | { type: "panel:get-state" }
  | { type: "panel:get-mix" }
  | {
      type:
        | "panel:surface-mounted"
        | "panel:surface-heartbeat"
        | "panel:surface-unmounted";
      surface: PanelSurface;
    }
  | { type: "panel:analyze-image"; image: CapturedImage }
  | { type: "panel:analyze-mix"; images?: CapturedImage[] }
  | {
      type: "panel:analyze-multi";
      mode: MultiAnalyzeMode;
      images?: CapturedImage[];
    }
  | { type: "panel:add-mix-images"; images: CapturedImage[] }
  | { type: "panel:set-mix-images"; images: CapturedImage[] }
  | { type: "panel:clear-mix" }
  | { type: "panel:remove-mix-image"; url: string }
  | {
      type: "panel:edit-prompt";
      document: PromptDocument;
      instruction: string;
      visualReferences?: EditVisualReference[];
    }
  | { type: "panel:cancel-task"; taskId?: string }
  | {
      type: "panel:privacy-consent-response";
      taskId: string;
      granted: boolean;
      remember: boolean;
    }
  | {
      type: "panel:save-history";
      document: PromptDocument;
      sourcePageUrl?: string;
      sourceTitle?: string;
      thumbnail?: string;
      referenceImages?: HistoryReferenceImage[];
    }
  | { type: "panel:generate-assistant-prompt"; input: AssistantPromptInput }
  | { type: "panel:get-assistant-history" }
  | { type: "panel:remove-assistant-history"; id: string }
  | { type: "panel:clear-assistant-history" }
  | { type: "panel:get-assistant-favorites" }
  | {
      type: "panel:add-assistant-favorite";
      name?: string;
      input: AssistantPromptInput;
      result: AssistantPromptResult;
      referenceImages?: HistoryReferenceImage[];
    }
  | { type: "panel:remove-assistant-favorite"; id: string }
  | { type: "panel:clear-assistant-favorites" }
  | {
      type: "panel:send-assistant-to-photoshop";
      input: AssistantPromptInput;
      result: AssistantPromptResult;
      targetStageId?: string;
    }
);

interface AssistantGenerateResponse {
  result: AssistantPromptResult;
  history: AssistantHistoryItem[];
}

interface PhotoshopInboxResponse {
  item: {
    id: string;
    receivedAt: string;
    finalPrompt: string;
  };
  history: unknown[];
}

interface ContentImageResponse {
  image?: CapturedImage;
}

interface ContentFloatingResponse {
  ok: boolean;
}

interface ConsentDecision {
  granted: boolean;
  remember: boolean;
}

let currentTask: TaskState | null = null;
let workspaceCounter = 0;
let popupOffsetIndex = 0;
let lastFocusedWorkspaceId: string | undefined;
let isQueuePumpRunning = false;
let mixImages: CapturedImage[] = [];
let panelSurfaceLastSeenAt: Record<PanelSurface, number> = {
  sidepanel: 0,
  floating: 0,
  popup: 0
};

const workspaces = new Map<string, WorkspaceState>();
const windowWorkspaceIndex = new Map<number, string>();
const tasks = new Map<string, TaskState>();
const queuedTaskIds: string[] = [];
const taskRunners = new Map<string, (controller: AbortController) => Promise<void>>();
const taskControllers = new Map<string, AbortController>();
const taskRejecters = new Map<string, (error: unknown) => void>();
const heartbeatTimers = new Map<string, ReturnType<typeof globalThis.setInterval>>();

const pendingConsent = new Map<
  string,
  {
    resolve: (decision: ConsentDecision) => void;
    timeoutId: ReturnType<typeof globalThis.setTimeout>;
  }
>();

chrome.runtime.onInstalled.addListener(() => {
  setupContextMenus();
  void configureSidePanelBehavior();
});

chrome.runtime.onStartup.addListener(() => {
  setupContextMenus();
  void configureSidePanelBehavior();
});

chrome.action.onClicked.addListener((tab) => {
  void openPopupWorkspace(tab);
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_ANALYZE_IMAGE) {
    void handleAnalyzeImageContextMenu(info, tab);
    return;
  }

  if (info.menuItemId === MENU_ADD_TO_MIX) {
    void handleAddToMixContextMenu(info, tab);
    return;
  }

  if (info.menuItemId === MENU_COPY_TAB_TO_WORKSPACE) {
    void handleCopyTabToWorkspaceContextMenu(tab);
  }
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === "open-panel") {
    void openPopupWorkspace(tab);
    return;
  }

  if (command === "analyze-selected-image") {
    void handleAnalyzeShortcut(tab);
    return;
  }

  if (command === "save-current-prompt" || command === "copy-current-json") {
    void broadcast({
      type: "background:shortcut",
      command
    });
  }
});

chrome.windows.onRemoved.addListener((windowId) => {
  const workspaceId = windowWorkspaceIndex.get(windowId);

  if (!workspaceId) {
    return;
  }

  cancelWorkspaceTasks(workspaceId);
  removeWorkspace(workspaceId);
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    return;
  }

  const workspaceId = windowWorkspaceIndex.get(windowId);

  if (workspaceId) {
    lastFocusedWorkspaceId = workspaceId;
  }
});

chrome.runtime.onMessage.addListener((message: RuntimeRequest, sender, sendResponse) => {
  void handleRuntimeMessage(message, sender)
    .then((data) => {
      sendResponse({ ok: true, data } satisfies RuntimeResponse);
    })
    .catch((error) => {
      sendResponse({
        ok: false,
        error: serializeError(error)
      } satisfies RuntimeResponse);
    });

  return true;
});

function setupContextMenus(): void {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ANALYZE_IMAGE,
      title: "反推提示词",
      contexts: ["all"]
    });

    chrome.contextMenus.create({
      id: MENU_ADD_TO_MIX,
      title: "添加到多图参考",
      contexts: ["all"]
    });

    chrome.contextMenus.create({
      id: MENU_COPY_TAB_TO_WORKSPACE,
      title: "复制当前标签页到任务窗口",
      contexts: ["page", "selection", "image", "link"]
    });
  });
}

async function configureSidePanelBehavior(): Promise<void> {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch {
    // Some Chromium variants expose sidePanel.open but not this helper.
  }
}

async function handleAnalyzeImageContextMenu(
  info: chrome.contextMenus.OnClickData,
  tab?: chrome.tabs.Tab
): Promise<void> {
  const image = await resolveCapturedImage(info, tab);
  const workspace = await openPopupWorkspace(tab);

  if (!image) {
    void broadcastError(
      createAppError("image_not_found", "No image was found under the context menu."),
      workspace.id
    );
    return;
  }

  await startAnalyzeTask(image, workspace.id);
}

async function handleAddToMixContextMenu(
  info: chrome.contextMenus.OnClickData,
  tab?: chrome.tabs.Tab
): Promise<void> {
  const image = await resolveCapturedImage(info, tab);

  if (!image) {
    const workspace = await openPopupWorkspace(tab);
    void broadcastError(
      createAppError("image_not_found", "No image was found under the context menu."),
      workspace.id
    );
    return;
  }

  const workspace = getLastFocusedWorkspace() ?? (await openPopupWorkspace(tab));
  await addMixImages([image], workspace.id);
}

async function handleCopyTabToWorkspaceContextMenu(tab?: chrome.tabs.Tab): Promise<void> {
  await copyCurrentTabToWorkspace(tab ?? (await getActiveTab()));
}

async function resolveCapturedImage(
  info: chrome.contextMenus.OnClickData,
  tab?: chrome.tabs.Tab
): Promise<CapturedImage | null> {
  const directImage = createCapturedImage(info, tab);

  if (directImage.url.trim()) {
    return directImage;
  }

  if (!tab?.id) {
    return null;
  }

  return getLastImageFromContent(tab);
}

async function openPopupWorkspace(
  tab?: chrome.tabs.Tab,
  title?: string
): Promise<WorkspaceState> {
  const workspace = createWorkspace("popup", title ?? createWorkspaceTitle(tab));

  return openPopupForWorkspace(workspace, tab, true);
}

async function openPopupForWorkspace(
  workspace: WorkspaceState,
  tab?: chrome.tabs.Tab,
  allowFallback = false
): Promise<WorkspaceState> {
  const offset = popupOffsetIndex % POPUP_OFFSET_LIMIT;
  popupOffsetIndex += 1;

  try {
    const popupWindow = await chrome.windows.create({
      url: chrome.runtime.getURL(
        `sidepanel.html?surface=popup&workspaceId=${encodeURIComponent(workspace.id)}`
      ),
      type: "popup",
      width: POPUP_WIDTH,
      height: POPUP_HEIGHT,
      left: POPUP_BASE_LEFT + offset * POPUP_OFFSET_STEP,
      top: POPUP_BASE_TOP + offset * POPUP_OFFSET_STEP,
      focused: true
    });

    if (typeof popupWindow.id === "number") {
      updateWorkspace(workspace.id, { surface: "popup", windowId: popupWindow.id });
      windowWorkspaceIndex.set(popupWindow.id, workspace.id);
    }
  } catch (error) {
    if (!allowFallback) {
      throw error;
    }

    await openFloatingPanelOrSidePanel(tab, "open");
  }

  lastFocusedWorkspaceId = workspace.id;
  return getWorkspace(workspace.id);
}

function createWorkspaceTitle(tab?: chrome.tabs.Tab): string {
  workspaceCounter += 1;
  const title = tab?.title?.trim();

  if (title) {
    return `任务 ${workspaceCounter} · ${truncateWorkspaceTitle(title)}`;
  }

  return `任务 ${workspaceCounter}`;
}

function createTabWorkspaceTitle(tab?: chrome.tabs.Tab): string {
  const title = tab?.title?.trim();

  if (title) {
    return `标签页 · ${truncateWorkspaceTitle(title)}`;
  }

  return "标签页";
}

function truncateWorkspaceTitle(value: string): string {
  return value.length > 24 ? `${value.slice(0, 24)}...` : value;
}

function resolveWorkspaceForRequest(
  message: RuntimeRequest,
  sender?: chrome.runtime.MessageSender
): WorkspaceState {
  const explicitWorkspaceId =
    message.workspaceId || readWorkspaceIdFromUrl(sender?.url);

  if (explicitWorkspaceId && workspaces.has(explicitWorkspaceId)) {
    return getWorkspace(explicitWorkspaceId);
  }

  if (explicitWorkspaceId) {
    return createWorkspace(
      readSurfaceFromUrl(sender?.url) ?? messageSurface(message) ?? "popup",
      undefined,
      explicitWorkspaceId
    );
  }

  return getDefaultWorkspace(messageSurface(message) ?? readSurfaceFromUrl(sender?.url));
}

function messageSurface(message: RuntimeRequest): PanelSurface | undefined {
  return "surface" in message ? message.surface : undefined;
}

function readWorkspaceIdFromUrl(url?: string): string | undefined {
  if (!url) {
    return undefined;
  }

  try {
    const workspaceId = new URL(url).searchParams.get("workspaceId")?.trim();
    return workspaceId || undefined;
  } catch {
    return undefined;
  }
}

function readSurfaceFromUrl(url?: string): PanelSurface | undefined {
  if (!url) {
    return undefined;
  }

  try {
    const surface = new URL(url).searchParams.get("surface");
    return isPanelSurface(surface) ? surface : undefined;
  } catch {
    return undefined;
  }
}

function isPanelSurface(value: unknown): value is PanelSurface {
  return value === "sidepanel" || value === "floating" || value === "popup";
}

function getDefaultWorkspace(surface: PanelSurface = "sidepanel"): WorkspaceState {
  if (workspaces.has(DEFAULT_WORKSPACE_ID)) {
    return getWorkspace(DEFAULT_WORKSPACE_ID);
  }

  return createWorkspace(surface, "默认任务窗口", DEFAULT_WORKSPACE_ID);
}

function createWorkspace(
  surface: PanelSurface = "popup",
  title?: string,
  requestedId?: string
): WorkspaceState {
  const now = new Date().toISOString();
  const id = requestedId ?? createWorkspaceId();
  const existing = workspaces.get(id);

  if (existing) {
    return existing;
  }

  const workspace: WorkspaceState = {
    id,
    title: title?.trim() || "任务窗口",
    surface,
    mixImages: [],
    createdAt: now,
    updatedAt: now
  };

  workspaces.set(workspace.id, workspace);
  void saveWorkspaceSnapshots();
  return workspace;
}

function createWorkspaceId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `workspace_${crypto.randomUUID()}`;
  }

  return `workspace_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function getWorkspace(workspaceId: string): WorkspaceState {
  return workspaces.get(workspaceId) ?? createWorkspace("sidepanel", undefined, workspaceId);
}

function updateWorkspace(
  workspaceId: string,
  updates: Partial<WorkspaceState>
): WorkspaceState {
  const current = getWorkspace(workspaceId);
  const next: WorkspaceState = {
    ...current,
    ...updates,
    id: current.id,
    mixImages: updates.mixImages ?? current.mixImages,
    updatedAt: new Date().toISOString()
  };

  workspaces.set(workspaceId, next);

  if (typeof next.windowId === "number") {
    windowWorkspaceIndex.set(next.windowId, workspaceId);
  }

  void saveWorkspaceSnapshots();
  return next;
}

function removeWorkspace(workspaceId: string): void {
  const workspace = workspaces.get(workspaceId);

  if (workspace?.windowId !== undefined) {
    windowWorkspaceIndex.delete(workspace.windowId);
  }

  workspaces.delete(workspaceId);

  if (lastFocusedWorkspaceId === workspaceId) {
    lastFocusedWorkspaceId = undefined;
  }

  void saveWorkspaceSnapshots();
}

function getLastFocusedWorkspace(): WorkspaceState | undefined {
  if (lastFocusedWorkspaceId && workspaces.has(lastFocusedWorkspaceId)) {
    return getWorkspace(lastFocusedWorkspaceId);
  }

  return Array.from(workspaces.values()).find((workspace) => workspace.surface === "popup");
}

function getWorkspaceActiveTask(workspaceId: string): TaskState | null {
  const workspace = getWorkspace(workspaceId);

  if (workspace.activeTaskId && tasks.has(workspace.activeTaskId)) {
    return tasks.get(workspace.activeTaskId)!;
  }

  return null;
}

function loadWorkspaceMixImages(workspaceId: string): CapturedImage[] {
  return getWorkspace(workspaceId).mixImages;
}

async function saveWorkspaceSnapshots(): Promise<void> {
  if (!chrome.storage?.session) {
    return;
  }

  try {
    await chrome.storage.session.set({
      [WORKSPACE_SESSION_KEY]: Array.from(workspaces.values())
    });
  } catch {
    // Session snapshots are best-effort; running task state remains in memory.
  }
}

async function handleRuntimeMessage(
  message: RuntimeRequest,
  sender?: chrome.runtime.MessageSender
): Promise<unknown> {
  if (message.type === "panel:create-workspace") {
    return createWorkspace(message.surface ?? "popup", message.title);
  }

  if (message.type === "panel:copy-current-tab") {
    return copyCurrentTabToWorkspace(sender?.tab ?? (await getActiveTab()));
  }

  const workspace = resolveWorkspaceForRequest(message, sender);

  switch (message.type) {
    case "panel:get-workspace-state": {
      const nextWorkspace = resolveWorkspaceForRequest(message, sender);
      return {
        workspace: nextWorkspace,
        task: getWorkspaceActiveTask(nextWorkspace.id)
      } satisfies WorkspaceResponse;
    }

    case "panel:update-workspace-draft": {
      const updates: Partial<WorkspaceState> = {};

      if (message.title?.trim()) {
        updates.title = message.title.trim();
      }

      if (message.mixImages) {
        updates.mixImages = message.mixImages.filter(isCapturedImage).slice(0, MAX_MIX_IMAGES);
      }

      return updateWorkspace(workspace.id, updates);
    }

    case "panel:detach-workspace":
      return detachWorkspaceToPopup(workspace, sender?.tab);

    case "panel:set-max-concurrency": {
      const settings = await saveSettings({
        maxConcurrentTasks: message.maxConcurrentTasks
      });
      void pumpTaskQueue();
      return settings;
    }

    case "panel:surface-mounted":
    case "panel:surface-heartbeat":
      markPanelSurfaceSeen(message.surface);
      return null;

    case "panel:surface-unmounted":
      markPanelSurfaceClosed(message.surface);
      return null;

    case "panel:get-state":
      return getWorkspaceActiveTask(workspace.id);

    case "panel:get-mix":
      return loadMixImages(workspace.id);

    case "panel:analyze-image":
      return startAnalyzeTask(message.image, workspace.id);

    case "panel:analyze-mix":
      return startAnalyzeMultiTask(
        "style_common",
        message.images ?? loadWorkspaceMixImages(workspace.id),
        workspace.id
      );

    case "panel:analyze-multi":
      return startAnalyzeMultiTask(
        message.mode,
        message.images ?? loadWorkspaceMixImages(workspace.id),
        workspace.id
      );

    case "panel:add-mix-images":
      return addMixImages(message.images, workspace.id);

    case "panel:set-mix-images":
      return setMixImages(message.images, workspace.id);

    case "panel:clear-mix":
      return setMixImages([], workspace.id);

    case "panel:remove-mix-image":
      return setMixImages(
        loadWorkspaceMixImages(workspace.id).filter((image) => image.url !== message.url),
        workspace.id
      );

    case "panel:edit-prompt":
      return startEditTask(
        message.document,
        message.instruction,
        message.visualReferences,
        workspace.id
      );

    case "panel:cancel-task":
      cancelCurrentTask(message.taskId, workspace.id);
      return getWorkspaceActiveTask(workspace.id);

    case "panel:privacy-consent-response":
      return handleConsentResponse(message);

    case "panel:save-history":
      return addHistoryItem({
        document: message.document,
        sourcePageUrl: message.sourcePageUrl,
        sourceTitle: message.sourceTitle,
        thumbnail: message.thumbnail,
        referenceImages: message.referenceImages
      }) satisfies Promise<PromptHistoryItem[]>;

    case "panel:generate-assistant-prompt":
      return generateAssistantPrompt(message.input, workspace.id);

    case "panel:get-assistant-history":
      return getAssistantHistory();

    case "panel:remove-assistant-history":
      return removeAssistantHistoryItem(message.id);

    case "panel:clear-assistant-history":
      await clearAssistantHistory();
      return [];

    case "panel:get-assistant-favorites":
      return getAssistantFavorites();

    case "panel:add-assistant-favorite": {
      const { signal: _signal, onProgress: _onProgress, ...storedInput } =
        message.input;

      return addAssistantFavoriteItem({
        name: message.name,
        input: storedInput,
        result: message.result,
        referenceImages: message.referenceImages
      }) satisfies Promise<AssistantFavoriteItem[]>;
    }

    case "panel:remove-assistant-favorite":
      return removeAssistantFavoriteItem(message.id);

    case "panel:clear-assistant-favorites":
      await clearAssistantFavorites();
      return [];

    case "panel:send-assistant-to-photoshop":
      return sendAssistantPromptToPhotoshop(
        message.input,
        message.result,
        message.targetStageId,
        workspace.title
      );

    default:
      throw createAppError("unknown_error", "Unsupported runtime message.");
  }
}

async function detachWorkspaceToPopup(
  workspace: WorkspaceState,
  tab?: chrome.tabs.Tab
): Promise<WorkspaceState> {
  return openPopupForWorkspace(workspace, tab, false);
}

async function copyCurrentTabToWorkspace(tab?: chrome.tabs.Tab): Promise<WorkspaceResponse> {
  const image = await captureCurrentTabSnapshot(tab);
  const workspace = await openPopupWorkspace(tab, createTabWorkspaceTitle(tab));

  if (!image) {
    void broadcastError(
      createAppError("image_not_found", "当前页面无法截图，已打开空任务窗口。"),
      workspace.id
    );

    return {
      workspace,
      task: getWorkspaceActiveTask(workspace.id)
    };
  }

  await startAnalyzeTask(image, workspace.id);

  return {
    workspace,
    task: getWorkspaceActiveTask(workspace.id)
  };
}

async function captureCurrentTabSnapshot(tab?: chrome.tabs.Tab): Promise<CapturedImage | null> {
  if (!tab?.id || isRestrictedUrl(tab.url)) {
    return null;
  }

  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: "jpeg",
      quality: 82
    });

    if (!dataUrl || !/^data:image\//i.test(dataUrl)) {
      return null;
    }

    return {
      url: dataUrl,
      sourcePageUrl: tab.url,
      sourceTitle: tab.title,
      tabId: tab.id
    };
  } catch {
    return null;
  }
}

async function sendAssistantPromptToPhotoshop(
  input: AssistantPromptInput,
  result: AssistantPromptResult,
  targetStageId?: string,
  workspaceTitle?: string
): Promise<PhotoshopInboxResponse> {
  if (!result.finalPrompt?.trim()) {
    throw createAppError("photoshop_bridge_unavailable", "No final prompt to send.");
  }

  const settings = await getSettings();
  const endpoint = createPromptInboxEndpoint(settings.photoshopBridgeUrl);
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(
        createPromptInboxPayload(input, result, targetStageId, workspaceTitle)
      ),
      signal: controller.signal
    });
    const responseText = await response.text();

    if (!response.ok) {
      throw createAppError(
        "photoshop_bridge_unavailable",
        `Photoshop Bridge returned HTTP ${response.status}.`,
        { status: response.status, responseText }
      );
    }

    try {
      return JSON.parse(responseText) as PhotoshopInboxResponse;
    } catch {
      throw createAppError(
        "photoshop_bridge_unavailable",
        "Photoshop Bridge returned a non-JSON response.",
        { responseText }
      );
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw createAppError(
        "photoshop_bridge_unavailable",
        "Photoshop Bridge request timed out.",
        { responseText: endpoint }
      );
    }

    if (error instanceof TypeError) {
      throw createAppError(
        "photoshop_bridge_unavailable",
        "Could not connect to Photoshop Bridge.",
        { responseText: endpoint }
      );
    }

    throw error;
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

function createPromptInboxPayload(
  input: AssistantPromptInput,
  result: AssistantPromptResult,
  targetStageId?: string,
  workspaceTitle?: string
): Record<string, unknown> {
  const normalizedTargetStageId = typeof targetStageId === "string" ? targetStageId.trim() : "";

  return {
    source: "browser-extension",
    sourceApp: "prompt-reverse-engineer-extension",
    workspaceTitle: workspaceTitle?.trim() || "",
    targetStageId: normalizedTargetStageId,
    idea: input.idea,
    brief: result.brief,
    finalPrompt: result.finalPrompt,
    chineseCheck: result.chineseCheck,
    negativeConstraints: result.negativeConstraints,
    references: input.references.map((reference, index) => ({
      label: reference.label || `图片 ${index + 1}`,
      role: reference.role,
      imageUrl: safeReferenceUrl(reference.imageUrl),
      sourceImageUrl: safeReferenceUrl(reference.sourceImageUrl),
      sourcePageUrl: reference.sourcePageUrl || "",
      sourceTitle: reference.sourceTitle || ""
    }))
  };
}

function createPromptInboxEndpoint(bridgeUrl: string): string {
  try {
    return new URL("/prompt-inbox", bridgeUrl.replace(/\/+$/, "") + "/").toString();
  } catch {
    throw createAppError(
      "photoshop_bridge_unavailable",
      "Invalid Photoshop Bridge URL.",
      { responseText: bridgeUrl }
    );
  }
}

function safeReferenceUrl(value: string | undefined): string {
  if (!value || /^data:image\//i.test(value)) {
    return "";
  }

  return value;
}

async function generateAssistantPrompt(
  input: AssistantPromptInput,
  workspaceId: string
): Promise<AssistantGenerateResponse> {
  const taskId = createTaskId("assistant");
  const createdAt = new Date().toISOString();

  return new Promise((resolve, reject) => {
    const { signal: _signal, onProgress: _onProgress, ...storedInput } = input;

    taskRejecters.set(taskId, reject);
    enqueueTask(
      {
        id: taskId,
        workspaceId,
        kind: "assistant",
        status: "queued",
        phase: "queued",
        message: "任务已加入队列",
        progressPercent: 0,
        progressLabel: "排队中",
        progressDetail: "等待并发空位",
        createdAt,
        updatedAt: createdAt,
        input: storedInput
      },
      async (controller) => {
        try {
          const response = await runAssistantPromptTask(taskId, input, controller);

          updateCurrentTask(taskId, {
            status: "done",
            phase: "done",
            message: "提示词生成完成",
            progressPercent: 100,
            progressLabel: "完成",
            progressDetail: "助手提示词已生成",
            assistantResult: response.result,
            historySaved: true
          });
          taskRejecters.delete(taskId);
          resolve(response);
        } catch (error) {
          handleTaskError(taskId, error);
          taskRejecters.delete(taskId);
          reject(error);
        }
      }
    );
  });
}

async function runAssistantPromptTask(
  taskId: string,
  input: AssistantPromptInput,
  controller: AbortController
): Promise<AssistantGenerateResponse> {
  const settings = await getSettings();

  if (!settings.apiBaseUrl || !settings.apiKey || !settings.model) {
    throw createAppError("missing_config", "API configuration is incomplete.");
  }

  const references = (input.references ?? []).slice(0, MAX_MIX_IMAGES);
  let preparedReferences = references;
  let referenceImages: HistoryReferenceImage[] = [];

  if (references.some((reference) => reference.imageUrl)) {
    const consent = await ensurePrivacyConsent(taskId);

    if (!consent.granted) {
      throw createAppError("privacy_denied", "User denied image upload.");
    }

    const preparedImages: PreparedImagePayload[] = [];
    const historySources: CapturedImage[] = [];

    preparedReferences = [];

    for (const reference of references) {
      if (!reference.imageUrl) {
        preparedReferences.push(reference);
        continue;
      }

      const source = {
        url: reference.imageUrl,
        sourcePageUrl: reference.sourcePageUrl,
        sourceTitle: reference.sourceTitle
      } satisfies CapturedImage;
      const preparedImage = await prepareImageForVision(source, {
        signal: controller.signal,
        onProgress: (event) => handleImageProgress(taskId, event)
      });

      historySources.push(source);
      preparedImages.push(preparedImage);
      preparedReferences.push({
        ...reference,
        imageUrl: preparedImage.imageUrl,
        sourceImageUrl: preparedImage.sourceImageUrl
      });
    }

    referenceImages = await createHistoryReferenceImages(
      historySources,
      preparedImages,
      controller.signal
    );
  }

  const result = await generateAssistantPromptWithGateway(
    {
      apiBaseUrl: settings.apiBaseUrl,
      apiKey: settings.apiKey,
      model: settings.model
    },
    {
      ...input,
      references: preparedReferences,
      signal: controller.signal,
      onProgress: (event) => handleApiProgress(taskId, event)
    }
  );
  const { signal: _signal, onProgress: _onProgress, ...storedInput } = {
    ...input,
    references: preparedReferences
  };
  const history = await addAssistantHistoryItem({
    input: storedInput,
    result,
    referenceImages
  });

  return { result, history };
}

async function startAnalyzeTask(
  image: CapturedImage,
  workspaceId: string
): Promise<TaskState> {

  const taskId = createTaskId("analyze");
  const createdAt = new Date().toISOString();

  return enqueueTask({
    id: taskId,
    workspaceId,
    kind: "analyze",
    status: "queued",
    phase: "queued",
    mode: "single",
    message: "正在准备图片",
    progressPercent: 0,
    progressLabel: "准备任务",
    progressDetail: "正在创建图片反推任务",
    createdAt,
    updatedAt: createdAt,
    source: image
  }, (controller) => runAnalyzeTask(taskId, image, controller));
}

async function startAnalyzeMultiTask(
  mode: MultiAnalyzeMode,
  images: CapturedImage[],
  workspaceId: string
): Promise<TaskState> {
  if (images.length < 2) {
    throw createAppError("image_not_found", "多图分析至少需要 2 张参考图。");
  }

  const taskId = createTaskId("analyze");
  const createdAt = new Date().toISOString();

  return enqueueTask({
    id: taskId,
    workspaceId,
    kind: "analyze",
    status: "queued",
    phase: "queued",
    mode,
    message:
      mode === "batch"
        ? `正在准备批量分析：${images.length} 张参考图`
        : `正在准备同风格分析：${images.length} 张参考图`,
    progressPercent: 0,
    progressLabel: "准备任务",
    progressDetail: mode === "batch" ? "正在创建批量反推任务" : "正在创建同风格分析任务",
    createdAt,
    updatedAt: createdAt,
    source: images[0],
    sources: images
  }, (controller) =>
    mode === "batch"
      ? runAnalyzeBatchTask(taskId, images, controller)
      : runAnalyzeStyleCommonTask(taskId, images, controller)
  );
}

async function runAnalyzeTask(
  taskId: string,
  image: CapturedImage,
  controller: AbortController
): Promise<void> {
  try {
    updateTaskProgress(taskId, 12, "读取配置", "正在读取 API 与模板设置");
    const { settings, template } = await measureTaskStep(taskId, "读取配置", async () => ({
      settings: await getSettings(),
      template: await getSelectedPromptTemplate()
    }));

    if (!settings.apiBaseUrl || !settings.apiKey || !settings.model) {
      throw createAppError("missing_config", "API configuration is incomplete.");
    }

    updateTaskProgress(taskId, 20, "图片上传授权", "等待确认是否允许发送图片到模型服务");
    const consent = await measureTaskStep(taskId, "图片上传授权", () =>
      ensurePrivacyConsent(taskId)
    );

    if (!consent.granted) {
      throw createAppError("privacy_denied", "User denied image upload.");
    }

    controller.signal.throwIfAborted();

    updateCurrentTask(taskId, {
      status: "preparing",
      phase: "prepare_image",
      message: "正在处理图片",
      progressPercent: 30,
      progressLabel: "处理图片",
      progressDetail: "正在准备视觉模型可读取的图片"
    });

    const preparedImage = await measureTaskStep(taskId, "图片处理", () =>
      prepareImageForVision(
        {
          url: image.url,
          sourcePageUrl: image.sourcePageUrl,
          sourceTitle: image.sourceTitle
        },
        {
          signal: controller.signal,
          onProgress: (event) => handleImageProgress(taskId, event)
        }
      )
    );
    const referenceImagesPromise = measureTaskStep(taskId, "历史缩略图", () =>
      createHistoryReferenceImages([image], [preparedImage], controller.signal)
    );

    updateCurrentTask(taskId, {
      preparedImage,
      status: "running",
      phase: "analyzing",
      message: "正在调用视觉模型",
      progressPercent: 72,
      progressLabel: "调用模型",
      progressDetail: "模型正在反推图像提示词"
    });

    const result = await measureTaskStep(taskId, "模型反推", () =>
      analyzeImagePrompt(
        {
          apiBaseUrl: settings.apiBaseUrl,
          apiKey: settings.apiKey,
          model: settings.model
        },
        {
          imageUrl: preparedImage.imageUrl,
          sourceImageUrl: preparedImage.sourceImageUrl,
          sourcePageUrl: image.sourcePageUrl,
          sourceTitle: image.sourceTitle,
          template,
          signal: controller.signal,
          onProgress: (event) => handleApiProgress(taskId, event)
        }
      )
    );
    const referenceImages = await referenceImagesPromise;

    updateCurrentTask(taskId, {
      status: "done",
      phase: "done",
      message: "分析完成",
      progressPercent: 100,
      progressLabel: "完成",
      progressDetail: "图片反推已完成",
      document: result.document,
      rawText: result.rawText,
      usedJsonMode: result.usedJsonMode,
      referenceImages
    });
  } catch (error) {
    handleTaskError(taskId, error);
  } finally {
    taskControllers.delete(taskId);
  }
}

async function runAnalyzeStyleCommonTask(
  taskId: string,
  images: CapturedImage[],
  controller: AbortController
): Promise<void> {
  try {
    updateTaskProgress(taskId, 12, "读取配置", "正在读取 API 与同风格模板");
    const { settings, template } = await measureTaskStep(taskId, "读取配置", async () => ({
      settings: await getSettings(),
      template: getBuiltInPromptTemplate("multi_style_common")
    }));

    if (!settings.apiBaseUrl || !settings.apiKey || !settings.model) {
      throw createAppError("missing_config", "API configuration is incomplete.");
    }

    updateTaskProgress(taskId, 20, "图片上传授权", "等待确认是否允许发送多图到模型服务");
    const consent = await measureTaskStep(taskId, "图片上传授权", () =>
      ensurePrivacyConsent(taskId)
    );

    if (!consent.granted) {
      throw createAppError("privacy_denied", "User denied image upload.");
    }

    controller.signal.throwIfAborted();

    const preparedImages: PreparedImagePayload[] = [];

    for (let index = 0; index < images.length; index += 1) {
      const image = images[index];

      if (!image) {
        continue;
      }

      updateCurrentTask(taskId, {
        status: "preparing",
        phase: "prepare_image",
        message: `同风格分析：正在处理第 ${index + 1}/${images.length} 张参考图`,
        progressPercent: calculateMultiImageProgress(index, images.length, 28, 64),
        progressLabel: "处理参考图",
        progressDetail: `正在处理第 ${index + 1}/${images.length} 张参考图`
      });

      preparedImages.push(
        await measureTaskStep(taskId, `图片处理 ${index + 1}/${images.length}`, () =>
          prepareImageForVision(
            {
              url: image.url,
              sourcePageUrl: image.sourcePageUrl,
              sourceTitle: image.sourceTitle
            },
            {
              signal: controller.signal,
              maxLongEdge: FAST_VISION_IMAGE_LONG_EDGE,
              maxBytes: FAST_VISION_MAX_DATA_URL_BYTES,
              initialQuality: FAST_VISION_JPEG_QUALITY,
              onProgress: (event) =>
                handleImageProgress(taskId, {
                  ...event,
                  message: `同风格 ${index + 1}/${images.length}：${event.message ?? ""}`
                })
            }
          )
        )
      );
    }
    const referenceImagesPromise = measureTaskStep(taskId, "历史缩略图", () =>
      createHistoryReferenceImages(images, preparedImages, controller.signal)
    );

    updateCurrentTask(taskId, {
      preparedImages,
      preparedImage: preparedImages[0],
      status: "running",
      phase: "analyzing",
      message: "正在调用视觉模型进行同风格分析",
      progressPercent: 74,
      progressLabel: "调用模型",
      progressDetail: "模型正在提取多图共享风格"
    });

    const result = await measureTaskStep(taskId, "同风格模型请求", () =>
      analyzeImageStyleCommonPrompt(
        {
          apiBaseUrl: settings.apiBaseUrl,
          apiKey: settings.apiKey,
          model: settings.model
        },
        {
          images: preparedImages.map((preparedImage, index) => ({
            imageUrl: preparedImage.imageUrl,
            sourceImageUrl: preparedImage.sourceImageUrl,
            sourcePageUrl: images[index]?.sourcePageUrl,
            sourceTitle: images[index]?.sourceTitle
          })),
          imageDetail: "low",
          template,
          signal: controller.signal,
          onProgress: (event) => handleApiProgress(taskId, event)
        }
      )
    );
    const referenceImages = await referenceImagesPromise;

    updateCurrentTask(taskId, {
      status: "done",
      phase: "done",
      message: "同风格分析完成",
      progressPercent: 100,
      progressLabel: "完成",
      progressDetail: "多图同风格分析已完成",
      document: result.document,
      rawText: result.rawText,
      usedJsonMode: result.usedJsonMode,
      referenceImages
    });
  } catch (error) {
    handleTaskError(taskId, error);
  } finally {
    taskControllers.delete(taskId);
  }
}

async function runAnalyzeBatchTask(
  taskId: string,
  images: CapturedImage[],
  controller: AbortController
): Promise<void> {
  try {
    updateTaskProgress(taskId, 12, "读取配置", "正在读取 API 与批量模板");
    const { settings, selectedTemplate } = await measureTaskStep(
      taskId,
      "读取配置",
      async () => ({
        settings: await getSettings(),
        selectedTemplate: await getSelectedPromptTemplate()
      })
    );
    const template =
      selectedTemplate.inputMode === "single_image"
        ? selectedTemplate
        : getDefaultPromptTemplate();

    if (!settings.apiBaseUrl || !settings.apiKey || !settings.model) {
      throw createAppError("missing_config", "API configuration is incomplete.");
    }

    updateTaskProgress(taskId, 20, "图片上传授权", "等待确认是否允许发送多图到模型服务");
    const consent = await measureTaskStep(taskId, "图片上传授权", () =>
      ensurePrivacyConsent(taskId)
    );

    if (!consent.granted) {
      throw createAppError("privacy_denied", "User denied image upload.");
    }

    controller.signal.throwIfAborted();

    const preparedImages: PreparedImagePayload[] = [];
    let lastResult:
      | {
          document: PromptDocument;
          rawText: string;
          usedJsonMode: boolean;
        }
      | null = null;
    let lastReferenceImages: HistoryReferenceImage[] = [];

    for (let index = 0; index < images.length; index += 1) {
      const image = images[index];

      if (!image) {
        continue;
      }

      updateCurrentTask(taskId, {
        status: "preparing",
        phase: "prepare_image",
        source: image,
        message: `批量分析：正在处理第 ${index + 1}/${images.length} 张参考图`,
        progressPercent: calculateMultiImageProgress(index, images.length, 24, 88),
        progressLabel: "批量处理",
        progressDetail: `正在处理第 ${index + 1}/${images.length} 张参考图`
      });

      const preparedImage = await measureTaskStep(
        taskId,
        `图片处理 ${index + 1}/${images.length}`,
        () =>
          prepareImageForVision(
            {
              url: image.url,
              sourcePageUrl: image.sourcePageUrl,
              sourceTitle: image.sourceTitle
            },
            {
              signal: controller.signal,
              onProgress: (event) =>
                handleImageProgress(taskId, {
                  ...event,
                  message: `批量 ${index + 1}/${images.length}：${event.message ?? ""}`
                })
            }
          )
      );
      preparedImages.push(preparedImage);
      const referenceImagesPromise = measureTaskStep(
        taskId,
        `历史缩略图 ${index + 1}/${images.length}`,
        () => createHistoryReferenceImages([image], [preparedImage], controller.signal)
      );

      updateCurrentTask(taskId, {
        preparedImage,
        preparedImages,
        status: "running",
        phase: "analyzing",
        message: `批量分析：正在分析第 ${index + 1}/${images.length} 张参考图`,
        progressPercent: calculateMultiImageProgress(index, images.length, 42, 94),
        progressLabel: "批量反推",
        progressDetail: `模型正在分析第 ${index + 1}/${images.length} 张图`
      });

      const result = await measureTaskStep(
        taskId,
        `模型反推 ${index + 1}/${images.length}`,
        () =>
          analyzeImagePrompt(
            {
              apiBaseUrl: settings.apiBaseUrl,
              apiKey: settings.apiKey,
              model: settings.model
            },
            {
              imageUrl: preparedImage.imageUrl,
              sourceImageUrl: preparedImage.sourceImageUrl,
              sourcePageUrl: image.sourcePageUrl,
              sourceTitle: image.sourceTitle,
              sourceType: "batch",
              template,
              signal: controller.signal,
              onProgress: (event) => handleApiProgress(taskId, event)
            }
          )
      );
      const referenceImages = await referenceImagesPromise;

      await measureTaskStep(taskId, `保存历史 ${index + 1}/${images.length}`, () =>
        addHistoryItem({
          document: result.document,
          sourcePageUrl: image.sourcePageUrl,
          sourceTitle: image.sourceTitle,
          thumbnail: referenceImages[0]?.thumbnail ?? referenceImages[0]?.url,
          referenceImages
        })
      );

      lastResult = result;
      lastReferenceImages = referenceImages;
    }

    if (!lastResult) {
      throw createAppError("image_not_found", "没有可分析的参考图。");
    }

    const lastImage = images[images.length - 1];
    const lastPreparedImage = preparedImages[preparedImages.length - 1];

    updateCurrentTask(taskId, {
      source: lastImage,
      sources: images,
      preparedImage: lastPreparedImage,
      preparedImages,
      referenceImages: lastReferenceImages,
      status: "done",
      phase: "done",
      message: `批量分析完成，已保存 ${images.length} 条历史记录`,
      progressPercent: 100,
      progressLabel: "完成",
      progressDetail: `批量分析完成，已保存 ${images.length} 条历史记录`,
      document: lastResult.document,
      rawText: lastResult.rawText,
      usedJsonMode: lastResult.usedJsonMode,
      historySaved: true
    });
  } catch (error) {
    handleTaskError(taskId, error);
  } finally {
    taskControllers.delete(taskId);
  }
}

async function startEditTask(
  document: PromptDocument,
  instruction: string,
  visualReferences: EditVisualReference[] = [],
  workspaceId: string
): Promise<TaskState> {
  const taskId = createTaskId("edit");
  const createdAt = new Date().toISOString();

  return enqueueTask({
    id: taskId,
    workspaceId,
    kind: "edit",
    status: "queued",
    phase: "queued",
    message: "正在修改 PromptDocument",
    progressPercent: 0,
    progressLabel: "编辑提示词",
    progressDetail: visualReferences.length ? "正在结合视觉参考修改 JSON" : "正在按文本指令修改 JSON",
    createdAt,
    updatedAt: createdAt,
    document
  }, (controller) =>
    runEditTask(
      taskId,
      document,
      instruction,
      visualReferences,
      controller
    )
  );
}

async function runEditTask(
  taskId: string,
  document: PromptDocument,
  instruction: string,
  visualReferences: EditVisualReference[],
  controller: AbortController
): Promise<void> {
  try {
    const { settings, template } = await measureTaskStep(taskId, "读取配置", async () => ({
      settings: await getSettings(),
      template: await getSelectedPromptTemplate()
    }));

    if (!settings.apiBaseUrl || !settings.apiKey || !settings.model) {
      throw createAppError("missing_config", "API configuration is incomplete.");
    }

    const result = await measureTaskStep(taskId, "模型编辑", () =>
      editPromptDocument(
        {
          apiBaseUrl: settings.apiBaseUrl,
          apiKey: settings.apiKey,
          model: settings.model
        },
        {
          document,
          instruction,
          template,
          visualReferences,
          signal: controller.signal,
          onProgress: (event) => handleApiProgress(taskId, event)
        }
      )
    );

    updateCurrentTask(taskId, {
      status: "done",
      phase: "done",
      message: "修改完成",
      progressPercent: 100,
      progressLabel: "完成",
      progressDetail: "提示词编辑已完成",
      document: result.document,
      rawText: result.rawText,
      usedJsonMode: result.usedJsonMode
    });
  } catch (error) {
    handleTaskError(taskId, error);
  } finally {
    taskControllers.delete(taskId);
  }
}

async function ensurePrivacyConsent(taskId: string): Promise<ConsentDecision> {
  const savedConsent = await getPrivacyConsent();

  if (savedConsent.remembered && savedConsent.granted) {
    return {
      granted: true,
      remember: true
    };
  }

  updateCurrentTask(taskId, {
    status: "awaiting_consent",
    phase: "privacy_consent",
    message: "等待图片上传授权"
  });

  const decision = await requestPrivacyConsent(taskId);

  if (decision.granted && decision.remember) {
    await savePrivacyConsent({
      remembered: true,
      granted: true
    });
  }

  return decision;
}

function requestPrivacyConsent(taskId: string): Promise<ConsentDecision> {
  return new Promise((resolve) => {
    const timeoutId = globalThis.setTimeout(() => {
      pendingConsent.delete(taskId);
      resolve({ granted: false, remember: false });
    }, CONSENT_TIMEOUT_MS);

    pendingConsent.set(taskId, {
      resolve,
      timeoutId
    });

    void broadcast({
      type: "background:privacy-consent-request",
      workspaceId: tasks.get(taskId)?.workspaceId,
      taskId,
      source: tasks.get(taskId)?.source
    });
  });
}

async function handleConsentResponse(message: {
  taskId: string;
  granted: boolean;
  remember: boolean;
}): Promise<TaskState | null> {
  const pending = pendingConsent.get(message.taskId);

  if (!pending) {
    return tasks.get(message.taskId) ?? currentTask;
  }

  globalThis.clearTimeout(pending.timeoutId);
  pendingConsent.delete(message.taskId);
  pending.resolve({
    granted: message.granted,
    remember: message.remember
  });

  return tasks.get(message.taskId) ?? currentTask;
}

function cancelCurrentTask(taskId?: string, workspaceId?: string): void {
  const targetTaskId =
    taskId ?? (workspaceId ? getWorkspace(workspaceId).activeTaskId : currentTask?.id);

  if (!targetTaskId) {
    return;
  }

  cancelTaskById(targetTaskId);
}

function cancelWorkspaceTasks(workspaceId: string): void {
  Array.from(tasks.values())
    .filter(
      (task) =>
        task.workspaceId === workspaceId &&
        (task.status === "queued" ||
          task.status === "awaiting_consent" ||
          task.status === "preparing" ||
          task.status === "running")
    )
    .forEach((task) => cancelTaskById(task.id));
}

function cancelTaskById(taskId: string): void {
  const task = tasks.get(taskId);

  if (!task || task.status === "done" || task.status === "cancelled") {
    return;
  }

  const queuedIndex = queuedTaskIds.indexOf(taskId);

  if (queuedIndex >= 0) {
    queuedTaskIds.splice(queuedIndex, 1);
  }

  taskControllers.get(taskId)?.abort();
  taskControllers.delete(taskId);
  taskRunners.delete(taskId);
  stopHeartbeat(taskId);
  resolvePendingConsentAsDenied(taskId);
  taskRejecters.get(taskId)?.(createAppError("request_cancelled", "Task was cancelled."));
  taskRejecters.delete(taskId);

  updateCurrentTask(taskId, {
    status: "cancelled",
    phase: "cancelled",
    message: "任务已取消",
    queuePosition: undefined
  });
  updateQueuePositions();
  void pumpTaskQueue();
}

function resolvePendingConsentAsDenied(taskId: string): void {
  const pending = pendingConsent.get(taskId);

  if (!pending) {
    return;
  }

  globalThis.clearTimeout(pending.timeoutId);
  pending.resolve({ granted: false, remember: false });
  pendingConsent.delete(taskId);
}
function handleImageProgress(taskId: string, event: ImagePipelineProgress): void {
  const percentByPhase: Record<ImagePipelineProgress["phase"], number> = {
    checking_url: 32,
    fetching_image: 42,
    decoding_image: 54,
    compressing_image: 64
  };
  const labelByPhase: Record<ImagePipelineProgress["phase"], string> = {
    checking_url: "检查图片",
    fetching_image: "读取图片",
    decoding_image: "解码图片",
    compressing_image: "压缩图片"
  };

  updateCurrentTask(taskId, {
    status: "preparing",
    phase: event.phase,
    message: event.message,
    progressPercent: Math.max(
      tasks.get(taskId)?.progressPercent ?? 0,
      percentByPhase[event.phase]
    ),
    progressLabel: labelByPhase[event.phase],
    progressDetail: event.message
  });
}

function handleApiProgress(taskId: string, event: ApiProgressEvent): void {
  const percentByPhase: Record<ApiProgressEvent["phase"], number> = {
    uploading: 70,
    analyzing: 82,
    editing: 82,
    parsing: 96,
    retrying: 78,
    json_mode_fallback: 76
  };
  const labelByPhase: Record<ApiProgressEvent["phase"], string> = {
    uploading: "上传请求",
    analyzing: "调用模型",
    editing: "编辑提示词",
    parsing: "解析结果",
    retrying: "重试请求",
    json_mode_fallback: "兼容重试"
  };

  updateCurrentTask(taskId, {
    status: "running",
    phase: event.phase,
    message: event.message,
    progressPercent: Math.max(
      tasks.get(taskId)?.progressPercent ?? 0,
      percentByPhase[event.phase]
    ),
    progressLabel: labelByPhase[event.phase],
    progressDetail: event.message
  });
}

function updateTaskProgress(
  taskId: string,
  progressPercent: number,
  progressLabel: string,
  progressDetail?: string
): void {
  updateCurrentTask(taskId, {
    progressPercent,
    progressLabel,
    progressDetail
  });
}

function calculateMultiImageProgress(
  index: number,
  total: number,
  start: number,
  end: number
): number {
  if (total <= 1) {
    return end;
  }

  const step = (end - start) / total;
  return Math.min(end, Math.round(start + step * index));
}

async function measureTaskStep<T>(
  taskId: string,
  label: string,
  run: () => Promise<T>
): Promise<T> {
  const startedAt = new Date();
  const startedMs = nowMs();

  try {
    const result = await run();
    appendTaskTiming(taskId, createTaskTiming(label, startedAt, startedMs, "done"));
    return result;
  } catch (error) {
    appendTaskTiming(
      taskId,
      createTaskTiming(label, startedAt, startedMs, "error", formatTimingError(error))
    );
    throw error;
  }
}

function appendTaskTiming(taskId: string, timing: TaskTimingEntry): void {
  const task = tasks.get(taskId);

  if (!task) {
    return;
  }

  const timings = [...(task.timings ?? []), timing].slice(-80);
  console.info("[AI Prompt Reverse Engineer timing]", {
    taskId,
    label: timing.label,
    durationMs: timing.durationMs,
    status: timing.status,
    detail: timing.detail
  });
  updateCurrentTask(taskId, { timings });
}

function createTaskTiming(
  label: string,
  startedAt: Date,
  startedMs: number,
  status: TaskTimingStatus,
  detail?: string
): TaskTimingEntry {
  const endedAt = new Date();

  return {
    id: `timing_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    label,
    durationMs: Math.max(0, Math.round(nowMs() - startedMs)),
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    status,
    detail
  };
}

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function formatTimingError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message?: unknown }).message ?? "Unknown error");
  }

  return String(error);
}

function handleTaskError(taskId: string, error: unknown): void {
  const userError = toUserFacingError(error);

  updateCurrentTask(taskId, {
    status: userError.code === "request_cancelled" ? "cancelled" : "error",
    phase: "error",
    message: userError.message,
    error: userError
  });
}

function enqueueTask(
  task: TaskState,
  runner: (controller: AbortController) => Promise<void>
): TaskState {
  taskRunners.set(task.id, runner);
  queuedTaskIds.push(task.id);
  setCurrentTask(task);
  updateQueuePositions();
  void pumpTaskQueue();
  return tasks.get(task.id)!;
}

async function pumpTaskQueue(): Promise<void> {
  if (isQueuePumpRunning) {
    return;
  }

  isQueuePumpRunning = true;

  try {
    const settings = await getSettings();
    const maxConcurrentTasks = settings.maxConcurrentTasks;

    while (getRunningTaskCount() < maxConcurrentTasks && queuedTaskIds.length) {
      const taskId = queuedTaskIds.shift()!;
      const task = tasks.get(taskId);
      const runner = taskRunners.get(taskId);

      if (!task || !runner || task.status !== "queued") {
        continue;
      }

      const controller = new AbortController();
      taskControllers.set(taskId, controller);
      updateCurrentTask(taskId, {
        status: task.kind === "edit" ? "running" : "preparing",
        phase: task.kind === "edit" ? "editing" : "preparing",
        message: task.kind === "assistant" ? "正在生成提示词" : "正在准备任务",
        progressPercent: task.kind === "edit" ? 68 : 8,
        progressLabel: task.kind === "edit" ? "编辑提示词" : "准备任务",
        progressDetail: "任务已开始",
        queuePosition: undefined
      });
      startHeartbeat(taskId);
      void runner(controller).finally(() => {
        taskControllers.delete(taskId);
        taskRunners.delete(taskId);
        stopHeartbeat(taskId);
        updateQueuePositions();
        void pumpTaskQueue();
      });
    }

    updateQueuePositions();
  } finally {
    isQueuePumpRunning = false;
  }
}

function getRunningTaskCount(): number {
  return Array.from(tasks.values()).filter(
    (task) =>
      task.status === "awaiting_consent" ||
      task.status === "preparing" ||
      task.status === "running"
  ).length;
}

function updateQueuePositions(): void {
  queuedTaskIds.forEach((taskId, index) => {
    const task = tasks.get(taskId);

    if (!task || task.status !== "queued") {
      return;
    }

    const nextQueuePosition = index + 1;

    if (task.queuePosition === nextQueuePosition) {
      return;
    }

    updateCurrentTask(taskId, {
      queuePosition: nextQueuePosition,
      progressDetail: `队列第 ${nextQueuePosition} 位`
    });
  });
}

function setCurrentTask(task: TaskState): void {
  tasks.set(task.id, task);
  currentTask = task;
  updateWorkspace(task.workspaceId, { activeTaskId: task.id });
  void broadcast({
    type: "background:task-state",
    workspaceId: task.workspaceId,
    task
  });
}

function updateCurrentTask(taskId: string, updates: Partial<TaskState>): void {
  const existing = tasks.get(taskId);

  if (!existing) {
    return;
  }

  const task = {
    ...existing,
    ...updates,
    updatedAt: new Date().toISOString()
  };
  tasks.set(taskId, task);
  currentTask = task;

  void broadcast({
    type: "background:task-state",
    workspaceId: task.workspaceId,
    task
  });

  if (task.status === "done") {
    updateWorkspace(task.workspaceId, {
      activeTaskId: task.id,
      lastResultTaskId: task.id
    });
  }
}

function startHeartbeat(taskId: string): void {
  stopHeartbeat(taskId);

  const heartbeatTimer = globalThis.setInterval(() => {
    const task = tasks.get(taskId);

    if (!task || task.status === "done" || task.status === "cancelled" || task.status === "error") {
      stopHeartbeat(taskId);
      return;
    }

    void broadcast({
      type: "background:heartbeat",
      workspaceId: task.workspaceId,
      taskId,
      updatedAt: new Date().toISOString()
    });
  }, HEARTBEAT_INTERVAL_MS);

  heartbeatTimers.set(taskId, heartbeatTimer);
}

function stopHeartbeat(taskId?: string): void {
  if (!taskId) {
    heartbeatTimers.forEach((timer) => globalThis.clearInterval(timer));
    heartbeatTimers.clear();
    return;
  }

  const heartbeatTimer = heartbeatTimers.get(taskId);

  if (!heartbeatTimer) {
    return;
  }

  globalThis.clearInterval(heartbeatTimer);
  heartbeatTimers.delete(taskId);
}

async function handleAnalyzeShortcut(tab?: chrome.tabs.Tab): Promise<void> {
  const activeTab = tab ?? (await getActiveTab());

  if (!activeTab?.id) {
    void broadcastError(createAppError("image_not_found", "No active tab."));
    return;
  }

  const workspace = await openPopupWorkspace(activeTab);

  const image = await getLastImageFromContent(activeTab);

  if (!image) {
    void broadcastError(
      createAppError(
        "image_not_found",
        "No recently hovered or right-clicked image was found in this tab."
      ),
      workspace.id
    );
    return;
  }

  await startAnalyzeTask(image, workspace.id);
}

async function getLastImageFromContent(
  tab: chrome.tabs.Tab
): Promise<CapturedImage | null> {
  if (!tab.id) {
    return null;
  }

  try {
    const response = await chrome.tabs.sendMessage<
      { type: "content:get-last-image" },
      ContentImageResponse
    >(tab.id, { type: "content:get-last-image" });

    return response.image ?? null;
  } catch {
    return null;
  }
}

async function openFloatingPanelOrSidePanel(
  tab?: chrome.tabs.Tab,
  mode: "open" | "toggle" = "open"
): Promise<void> {
  if (await isSidePanelSurfaceActive()) {
    await openPanel(tab);
    return;
  }

  const didOpenFloatingPanel = await openFloatingPanel(tab, mode);

  if (!didOpenFloatingPanel) {
    await openPanel(tab);
  }
}

async function openFloatingPanel(
  tab?: chrome.tabs.Tab,
  mode: "open" | "toggle" = "open"
): Promise<boolean> {
  const targetTab = tab?.id ? tab : await getActiveTab();

  if (!targetTab?.id || isRestrictedUrl(targetTab.url)) {
    return false;
  }

  try {
    const response = await chrome.tabs.sendMessage<
      { type: "content:open-floating-panel" | "content:toggle-floating-panel" },
      ContentFloatingResponse
    >(targetTab.id, {
      type:
        mode === "toggle"
          ? "content:toggle-floating-panel"
          : "content:open-floating-panel"
    });

    return response?.ok === true;
  } catch {
    return false;
  }
}

async function openPanel(tab?: chrome.tabs.Tab): Promise<void> {
  if (!chrome.sidePanel?.open) {
    return;
  }

  try {
    if (tab?.id) {
      await chrome.sidePanel.open({ tabId: tab.id });
      return;
    }

    if (tab?.windowId) {
      await chrome.sidePanel.open({ windowId: tab.windowId });
      return;
    }

    const activeTab = await getActiveTab();

    if (activeTab?.id) {
      await chrome.sidePanel.open({ tabId: activeTab.id });
    }
  } catch {
    // Opening the side panel is user-gesture sensitive in some builds.
    // The task still proceeds, and the panel can be opened from the toolbar.
  }
}

function markPanelSurfaceSeen(surface: PanelSurface): void {
  panelSurfaceLastSeenAt[surface] = Date.now();
}

function markPanelSurfaceClosed(surface: PanelSurface): void {
  panelSurfaceLastSeenAt[surface] = 0;
}

async function isSidePanelSurfaceActive(): Promise<boolean> {
  if (Date.now() - panelSurfaceLastSeenAt.sidepanel <= PANEL_SURFACE_HEARTBEAT_TTL_MS) {
    return true;
  }

  try {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.SIDE_PANEL]
    });

    if (contexts.length > 0) {
      markPanelSurfaceSeen("sidepanel");
      return true;
    }
  } catch {
    // Older Chromium builds may not expose runtime.getContexts.
  }

  return false;
}

function isRestrictedUrl(url?: string): boolean {
  if (!url) {
    return false;
  }

  return (
    url.startsWith("chrome://") ||
    url.startsWith("edge://") ||
    url.startsWith("about:") ||
    url.startsWith("chrome-extension://") ||
    url.startsWith("https://chromewebstore.google.com/") ||
    url.startsWith("https://chrome.google.com/webstore/")
  );
}

async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const tabs = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  return tabs[0];
}

function createCapturedImage(
  info: chrome.contextMenus.OnClickData,
  tab?: chrome.tabs.Tab
): CapturedImage {
  return {
    url: getContextImageUrl(info),
    sourcePageUrl: info.pageUrl ?? tab?.url,
    sourceTitle: tab?.title,
    tabId: tab?.id
  };
}

function getContextImageUrl(info: chrome.contextMenus.OnClickData): string {
  if (info.srcUrl) {
    return info.srcUrl;
  }

  if (info.linkUrl && isLikelyImageUrl(info.linkUrl)) {
    return info.linkUrl;
  }

  return "";
}

function isLikelyImageUrl(value: string): boolean {
  return (
    /^data:image\//i.test(value) ||
    /\.(?:avif|gif|jpe?g|png|svg|webp)(?:[?#].*)?$/i.test(value)
  );
}

async function addMixImages(
  images: CapturedImage[],
  workspaceId: string
): Promise<CapturedImage[]> {
  const nextImages = images.filter((image) => image.url.trim());
  const nextUrls = new Set(nextImages.map((image) => image.url));
  const currentMixImages = loadWorkspaceMixImages(workspaceId);
  const withoutDuplicates = currentMixImages.filter((image) => !nextUrls.has(image.url));
  const nextMixImages = [...nextImages, ...withoutDuplicates].slice(0, MAX_MIX_IMAGES);

  updateWorkspace(workspaceId, { mixImages: nextMixImages });
  await saveMixImages(nextMixImages, workspaceId);
  void broadcastMixUpdated(workspaceId);
  return nextMixImages;
}

async function setMixImages(
  images: CapturedImage[],
  workspaceId: string
): Promise<CapturedImage[]> {
  const nextMixImages = images.filter(isCapturedImage).slice(0, MAX_MIX_IMAGES);

  updateWorkspace(workspaceId, { mixImages: nextMixImages });
  await saveMixImages(nextMixImages, workspaceId);
  void broadcastMixUpdated(workspaceId);
  return nextMixImages;
}

async function createHistoryReferenceImages(
  images: CapturedImage[],
  preparedImages: PreparedImagePayload[],
  signal?: AbortSignal
): Promise<HistoryReferenceImage[]> {
  const references = await Promise.all(
    images.slice(0, MAX_MIX_IMAGES).map(async (image, index) => {
      const preparedImage = preparedImages[index];
      const thumbnail = preparedImage
        ? await createHistoryThumbnail(preparedImage.imageUrl, signal)
        : undefined;

      return {
        id: `img_${String(index + 1).padStart(3, "0")}`,
        url: thumbnail?.dataUrl ?? createFallbackReferenceUrl(image.url),
        sourceImageUrl: preparedImage?.sourceImageUrl ?? createFallbackReferenceUrl(image.url),
        sourcePageUrl: image.sourcePageUrl,
        sourceTitle: image.sourceTitle,
        thumbnail: thumbnail?.dataUrl ?? createFallbackReferenceUrl(image.url),
        width: thumbnail?.width ?? preparedImage?.width,
        height: thumbnail?.height ?? preparedImage?.height
      } satisfies HistoryReferenceImage;
    })
  );

  return references.filter((reference) =>
    Boolean(reference.url || reference.thumbnail || reference.sourceImageUrl)
  );
}

async function createHistoryThumbnail(
  imageUrl: string,
  signal?: AbortSignal
): Promise<{ dataUrl: string; width: number; height: number } | undefined> {
  try {
    const thumbnail = await createImageThumbnailDataUrl(imageUrl, { signal });

    return {
      dataUrl: thumbnail.dataUrl,
      width: thumbnail.width,
      height: thumbnail.height
    };
  } catch {
    return undefined;
  }
}

function createFallbackReferenceUrl(url: string): string | undefined {
  const trimmed = url.trim();

  if (/^https?:\/\//i.test(trimmed) || /^upload:\/\//i.test(trimmed)) {
    return trimmed;
  }

  if (/^clipboard:\/\//i.test(trimmed)) {
    return trimmed;
  }

  return undefined;
}

async function loadMixImages(workspaceId: string): Promise<CapturedImage[]> {
  const workspace = getWorkspace(workspaceId);

  if (workspace.mixImages.length) {
    return workspace.mixImages;
  }

  if (workspaceId !== DEFAULT_WORKSPACE_ID) {
    return workspace.mixImages;
  }

  const stored = await chrome.storage.local.get(MIX_IMAGES_KEY);
  const images = stored[MIX_IMAGES_KEY];
  const nextMixImages = Array.isArray(images)
    ? images.filter(isCapturedImage).slice(0, MAX_MIX_IMAGES)
    : [];

  updateWorkspace(workspaceId, { mixImages: nextMixImages });
  mixImages = nextMixImages;
  return nextMixImages;
}

async function saveMixImages(
  images: CapturedImage[],
  workspaceId: string
): Promise<void> {
  if (workspaceId === DEFAULT_WORKSPACE_ID) {
    mixImages = images;
    await chrome.storage.local.set({ [MIX_IMAGES_KEY]: images });
  }
}

function isCapturedImage(value: unknown): value is CapturedImage {
  return (
    typeof value === "object" &&
    value !== null &&
    "url" in value &&
    typeof (value as { url?: unknown }).url === "string"
  );
}

async function broadcast(message: unknown): Promise<void> {
  try {
    await chrome.runtime.sendMessage(message);
  } catch {
    // It is normal for no side panel to be listening yet.
  }
}

async function broadcastMixUpdated(workspaceId: string): Promise<void> {
  await broadcast({
    type: "background:mix-updated",
    workspaceId,
    images: loadWorkspaceMixImages(workspaceId)
  });
}

async function broadcastError(error: unknown, workspaceId?: string): Promise<void> {
  await broadcast({
    type: "background:error",
    workspaceId,
    error: toUserFacingError(error)
  });
}

function createTaskId(kind: TaskKind): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${kind}_${crypto.randomUUID()}`;
  }

  return `${kind}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

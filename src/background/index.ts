import { createAppError, serializeError, toUserFacingError } from "../lib/errors";
import {
  prepareImageForVision,
  type ImagePipelineProgress,
  type PreparedImagePayload
} from "../lib/imagePipeline";
import {
  analyzeImageMixPrompt,
  analyzeImagePrompt,
  editPromptDocument,
  type ApiProgressEvent
} from "../lib/openaiClient";
import type { PromptDocument } from "../lib/promptDocument";
import {
  addHistoryItem,
  getPrivacyConsent,
  getSelectedPromptTemplate,
  getSettings,
  savePrivacyConsent,
  type PromptHistoryItem
} from "../lib/storage";

const MENU_ANALYZE_IMAGE = "prompt-reverse:analyze-image";
const MENU_ADD_TO_MIX = "prompt-reverse:add-to-mix";
const CONSENT_TIMEOUT_MS = 5 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 15_000;
const MAX_MIX_IMAGES = 6;
const MIX_IMAGES_KEY = "mixImages";

type TaskStatus =
  | "idle"
  | "awaiting_consent"
  | "preparing"
  | "running"
  | "done"
  | "error"
  | "cancelled";

type TaskKind = "analyze" | "edit";

interface CapturedImage {
  url: string;
  sourcePageUrl?: string;
  sourceTitle?: string;
  tabId?: number;
}

interface TaskState {
  id: string;
  kind: TaskKind;
  status: TaskStatus;
  phase?: string;
  message?: string;
  createdAt: string;
  updatedAt: string;
  source?: CapturedImage;
  sources?: CapturedImage[];
  preparedImage?: PreparedImagePayload;
  preparedImages?: PreparedImagePayload[];
  document?: PromptDocument;
  rawText?: string;
  usedJsonMode?: boolean;
  error?: ReturnType<typeof toUserFacingError>;
}

interface EditVisualReference {
  imageUrl: string;
  sourceImageUrl?: string;
}

interface RuntimeResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: ReturnType<typeof serializeError>;
}

type RuntimeRequest =
  | { type: "panel:get-state" }
  | { type: "panel:get-mix" }
  | { type: "panel:analyze-image"; image: CapturedImage }
  | { type: "panel:analyze-mix"; images?: CapturedImage[] }
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
    };

interface ContentImageResponse {
  image?: CapturedImage;
}

interface ConsentDecision {
  granted: boolean;
  remember: boolean;
}

let currentTask: TaskState | null = null;
let activeController: AbortController | null = null;
let heartbeatTimer: ReturnType<typeof globalThis.setInterval> | undefined;
let mixImages: CapturedImage[] = [];

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
  void openPanel(tab);
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_ANALYZE_IMAGE) {
    const image = createCapturedImage(info, tab);
    void openPanel(tab).then(() => startAnalyzeTask(image));
    return;
  }

  if (info.menuItemId === MENU_ADD_TO_MIX) {
    const image = createCapturedImage(info, tab);
    void addMixImage(image).then(() => openPanel(tab));
  }
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === "open-panel") {
    void openPanel(tab);
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

chrome.runtime.onMessage.addListener((message: RuntimeRequest, _sender, sendResponse) => {
  void handleRuntimeMessage(message)
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
      contexts: ["image"]
    });

    chrome.contextMenus.create({
      id: MENU_ADD_TO_MIX,
      title: "添加到混搭",
      contexts: ["image"]
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

async function handleRuntimeMessage(message: RuntimeRequest): Promise<unknown> {
  switch (message.type) {
    case "panel:get-state":
      return currentTask;

    case "panel:get-mix":
      return loadMixImages();

    case "panel:analyze-image":
      return startAnalyzeTask(message.image);

    case "panel:analyze-mix":
      return startAnalyzeMixTask(message.images ?? mixImages);

    case "panel:clear-mix":
      mixImages = [];
      await saveMixImages(mixImages);
      void broadcastMixUpdated();
      return mixImages;

    case "panel:remove-mix-image":
      await loadMixImages();
      mixImages = mixImages.filter((image) => image.url !== message.url);
      await saveMixImages(mixImages);
      void broadcastMixUpdated();
      return mixImages;

    case "panel:edit-prompt":
      return startEditTask(
        message.document,
        message.instruction,
        message.visualReferences
      );

    case "panel:cancel-task":
      cancelCurrentTask(message.taskId);
      return currentTask;

    case "panel:privacy-consent-response":
      return handleConsentResponse(message);

    case "panel:save-history":
      return addHistoryItem({
        document: message.document,
        sourcePageUrl: message.sourcePageUrl,
        sourceTitle: message.sourceTitle,
        thumbnail: message.thumbnail
      }) satisfies Promise<PromptHistoryItem[]>;

    default:
      throw createAppError("unknown_error", "Unsupported runtime message.");
  }
}

async function startAnalyzeTask(image: CapturedImage): Promise<TaskState> {
  cancelCurrentTask();

  const taskId = createTaskId("analyze");
  const controller = new AbortController();
  activeController = controller;

  setCurrentTask({
    id: taskId,
    kind: "analyze",
    status: "preparing",
    message: "正在准备图片",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    source: image
  });

  startHeartbeat(taskId);

  void runAnalyzeTask(taskId, image, controller).finally(() => {
    stopHeartbeat(taskId);
  });

  return currentTask!;
}

async function startAnalyzeMixTask(images: CapturedImage[]): Promise<TaskState> {
  if (images.length < 2) {
    throw createAppError("image_not_found", "混搭模式至少需要 2 张参考图。");
  }

  cancelCurrentTask();

  const taskId = createTaskId("analyze");
  const controller = new AbortController();
  activeController = controller;

  setCurrentTask({
    id: taskId,
    kind: "analyze",
    status: "preparing",
    message: `正在准备 ${images.length} 张参考图`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    source: images[0],
    sources: images
  });

  startHeartbeat(taskId);

  void runAnalyzeMixTask(taskId, images, controller).finally(() => {
    stopHeartbeat(taskId);
  });

  return currentTask!;
}

async function runAnalyzeTask(
  taskId: string,
  image: CapturedImage,
  controller: AbortController
): Promise<void> {
  try {
    const settings = await getSettings();
    const template = await getSelectedPromptTemplate();

    if (!settings.apiBaseUrl || !settings.apiKey || !settings.model) {
      throw createAppError("missing_config", "API configuration is incomplete.");
    }

    const consent = await ensurePrivacyConsent(taskId);

    if (!consent.granted) {
      throw createAppError("privacy_denied", "User denied image upload.");
    }

    controller.signal.throwIfAborted();

    updateCurrentTask(taskId, {
      status: "preparing",
      phase: "prepare_image",
      message: "正在处理图片"
    });

    const preparedImage = await prepareImageForVision(
      {
        url: image.url,
        sourcePageUrl: image.sourcePageUrl,
        sourceTitle: image.sourceTitle
      },
      {
        signal: controller.signal,
        onProgress: (event) => handleImageProgress(taskId, event)
      }
    );

    updateCurrentTask(taskId, {
      preparedImage,
      status: "running",
      phase: "analyzing",
      message: "正在调用视觉模型"
    });

    const result = await analyzeImagePrompt(
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
    );

    updateCurrentTask(taskId, {
      status: "done",
      phase: "done",
      message: "分析完成",
      document: result.document,
      rawText: result.rawText,
      usedJsonMode: result.usedJsonMode
    });
  } catch (error) {
    handleTaskError(taskId, error);
  } finally {
    if (currentTask?.id === taskId) {
      activeController = null;
    }
  }
}

async function runAnalyzeMixTask(
  taskId: string,
  images: CapturedImage[],
  controller: AbortController
): Promise<void> {
  try {
    const settings = await getSettings();
    const template = await getSelectedPromptTemplate();

    if (!settings.apiBaseUrl || !settings.apiKey || !settings.model) {
      throw createAppError("missing_config", "API configuration is incomplete.");
    }

    const consent = await ensurePrivacyConsent(taskId);

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
        message: `正在处理第 ${index + 1}/${images.length} 张参考图`
      });

      preparedImages.push(
        await prepareImageForVision(
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
                message: `第 ${index + 1}/${images.length} 张：${event.message ?? ""}`
              })
          }
        )
      );
    }

    updateCurrentTask(taskId, {
      preparedImages,
      preparedImage: preparedImages[0],
      status: "running",
      phase: "analyzing",
      message: "正在调用视觉模型进行混搭反推"
    });

    const result = await analyzeImageMixPrompt(
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
        template,
        signal: controller.signal,
        onProgress: (event) => handleApiProgress(taskId, event)
      }
    );

    updateCurrentTask(taskId, {
      status: "done",
      phase: "done",
      message: "混搭分析完成",
      document: result.document,
      rawText: result.rawText,
      usedJsonMode: result.usedJsonMode
    });
  } catch (error) {
    handleTaskError(taskId, error);
  } finally {
    if (currentTask?.id === taskId) {
      activeController = null;
    }
  }
}

async function startEditTask(
  document: PromptDocument,
  instruction: string,
  visualReferences: EditVisualReference[] = []
): Promise<TaskState> {
  cancelCurrentTask();

  const taskId = createTaskId("edit");
  const controller = new AbortController();
  activeController = controller;

  setCurrentTask({
    id: taskId,
    kind: "edit",
    status: "running",
    phase: "editing",
    message: "正在修改 PromptDocument",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    document
  });

  startHeartbeat(taskId);

  void runEditTask(
    taskId,
    document,
    instruction,
    visualReferences,
    controller
  ).finally(() => {
    stopHeartbeat(taskId);
  });

  return currentTask!;
}

async function runEditTask(
  taskId: string,
  document: PromptDocument,
  instruction: string,
  visualReferences: EditVisualReference[],
  controller: AbortController
): Promise<void> {
  try {
    const settings = await getSettings();
    const template = await getSelectedPromptTemplate();

    if (!settings.apiBaseUrl || !settings.apiKey || !settings.model) {
      throw createAppError("missing_config", "API configuration is incomplete.");
    }

    const result = await editPromptDocument(
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
    );

    updateCurrentTask(taskId, {
      status: "done",
      phase: "done",
      message: "修改完成",
      document: result.document,
      rawText: result.rawText,
      usedJsonMode: result.usedJsonMode
    });
  } catch (error) {
    handleTaskError(taskId, error);
  } finally {
    if (currentTask?.id === taskId) {
      activeController = null;
    }
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
      taskId,
      source: currentTask?.source
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
    return currentTask;
  }

  globalThis.clearTimeout(pending.timeoutId);
  pendingConsent.delete(message.taskId);
  pending.resolve({
    granted: message.granted,
    remember: message.remember
  });

  return currentTask;
}

function cancelCurrentTask(taskId?: string): void {
  if (taskId && currentTask?.id !== taskId) {
    return;
  }

  activeController?.abort();
  activeController = null;

  if (currentTask) {
    const pending = pendingConsent.get(currentTask.id);

    if (pending) {
      globalThis.clearTimeout(pending.timeoutId);
      pending.resolve({ granted: false, remember: false });
      pendingConsent.delete(currentTask.id);
    }

    updateCurrentTask(currentTask.id, {
      status: "cancelled",
      phase: "cancelled",
      message: "任务已取消"
    });
  }
}

function handleImageProgress(taskId: string, event: ImagePipelineProgress): void {
  updateCurrentTask(taskId, {
    status: "preparing",
    phase: event.phase,
    message: event.message
  });
}

function handleApiProgress(taskId: string, event: ApiProgressEvent): void {
  updateCurrentTask(taskId, {
    status: "running",
    phase: event.phase,
    message: event.message,
  });
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

function setCurrentTask(task: TaskState): void {
  currentTask = task;
  void broadcast({
    type: "background:task-state",
    task: currentTask
  });
}

function updateCurrentTask(taskId: string, updates: Partial<TaskState>): void {
  if (!currentTask || currentTask.id !== taskId) {
    return;
  }

  currentTask = {
    ...currentTask,
    ...updates,
    updatedAt: new Date().toISOString()
  };

  void broadcast({
    type: "background:task-state",
    task: currentTask
  });
}

function startHeartbeat(taskId: string): void {
  stopHeartbeat();

  heartbeatTimer = globalThis.setInterval(() => {
    if (currentTask?.id !== taskId) {
      stopHeartbeat(taskId);
      return;
    }

    void broadcast({
      type: "background:heartbeat",
      taskId,
      updatedAt: new Date().toISOString()
    });
  }, HEARTBEAT_INTERVAL_MS);
}

function stopHeartbeat(taskId?: string): void {
  if (!heartbeatTimer) {
    return;
  }

  if (taskId && currentTask?.id !== taskId) {
    return;
  }

  globalThis.clearInterval(heartbeatTimer);
  heartbeatTimer = undefined;
}

async function handleAnalyzeShortcut(tab?: chrome.tabs.Tab): Promise<void> {
  const activeTab = tab ?? (await getActiveTab());

  if (!activeTab?.id) {
    void broadcastError(createAppError("image_not_found", "No active tab."));
    return;
  }

  await openPanel(activeTab);

  const image = await getLastImageFromContent(activeTab);

  if (!image) {
    void broadcastError(
      createAppError(
        "image_not_found",
        "No recently hovered or right-clicked image was found in this tab."
      )
    );
    return;
  }

  await startAnalyzeTask(image);
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
    url: info.srcUrl ?? "",
    sourcePageUrl: info.pageUrl ?? tab?.url,
    sourceTitle: tab?.title,
    tabId: tab?.id
  };
}

async function addMixImage(image: CapturedImage): Promise<void> {
  if (!image.url.trim()) {
    return;
  }

  await loadMixImages();
  const withoutDuplicate = mixImages.filter((item) => item.url !== image.url);
  mixImages = [image, ...withoutDuplicate].slice(0, MAX_MIX_IMAGES);
  await saveMixImages(mixImages);
  void broadcastMixUpdated();
}

async function loadMixImages(): Promise<CapturedImage[]> {
  const stored = await chrome.storage.local.get(MIX_IMAGES_KEY);
  const images = stored[MIX_IMAGES_KEY];

  mixImages = Array.isArray(images)
    ? images.filter(isCapturedImage).slice(0, MAX_MIX_IMAGES)
    : [];

  return mixImages;
}

async function saveMixImages(images: CapturedImage[]): Promise<void> {
  await chrome.storage.local.set({ [MIX_IMAGES_KEY]: images });
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

async function broadcastMixUpdated(): Promise<void> {
  await broadcast({
    type: "background:mix-updated",
    images: mixImages
  });
}

async function broadcastError(error: unknown): Promise<void> {
  await broadcast({
    type: "background:error",
    error: toUserFacingError(error)
  });
}

function createTaskId(kind: TaskKind): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${kind}_${crypto.randomUUID()}`;
  }

  return `${kind}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

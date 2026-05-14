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
  generateNanoBananaAssistantPrompt,
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
  clearAssistantHistory,
  getPrivacyConsent,
  getAssistantHistory,
  getSelectedPromptTemplate,
  getSettings,
  removeAssistantHistoryItem,
  savePrivacyConsent,
  type AssistantHistoryItem,
  type HistoryReferenceImage,
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

type TaskKind = "analyze" | "edit" | "assistant";
type MultiAnalyzeMode = "style_common" | "batch";
type TaskMode = "single" | MultiAnalyzeMode;
type TaskTimingStatus = "done" | "error";

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
  mode?: TaskMode;
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
  timings?: TaskTimingEntry[];
  progressPercent?: number;
  progressLabel?: string;
  progressDetail?: string;
  error?: ReturnType<typeof toUserFacingError>;
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

type RuntimeRequest =
  | { type: "panel:get-state" }
  | { type: "panel:get-mix" }
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
  | { type: "panel:clear-assistant-history" };

interface AssistantGenerateResponse {
  result: AssistantPromptResult;
  history: AssistantHistoryItem[];
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
  void openFloatingPanelOrSidePanel(tab, "toggle");
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_ANALYZE_IMAGE) {
    const image = createCapturedImage(info, tab);
    void openFloatingPanelOrSidePanel(tab, "open").then(() => startAnalyzeTask(image));
    return;
  }

  if (info.menuItemId === MENU_ADD_TO_MIX) {
    const image = createCapturedImage(info, tab);
    void addMixImages([image]).then(() => openFloatingPanelOrSidePanel(tab, "open"));
  }
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === "open-panel") {
    void openFloatingPanelOrSidePanel(tab, "toggle");
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
      title: "添加到多图参考",
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
      return startAnalyzeMultiTask("style_common", message.images ?? mixImages);

    case "panel:analyze-multi":
      return startAnalyzeMultiTask(message.mode, message.images ?? mixImages);

    case "panel:add-mix-images":
      return addMixImages(message.images);

    case "panel:set-mix-images":
      return setMixImages(message.images);

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
        thumbnail: message.thumbnail,
        referenceImages: message.referenceImages
      }) satisfies Promise<PromptHistoryItem[]>;

    case "panel:generate-assistant-prompt":
      return generateAssistantPrompt(message.input);

    case "panel:get-assistant-history":
      return getAssistantHistory();

    case "panel:remove-assistant-history":
      return removeAssistantHistoryItem(message.id);

    case "panel:clear-assistant-history":
      await clearAssistantHistory();
      return [];

    default:
      throw createAppError("unknown_error", "Unsupported runtime message.");
  }
}

async function generateAssistantPrompt(
  input: AssistantPromptInput
): Promise<AssistantGenerateResponse> {
  const taskId = createTaskId("assistant");
  const controller = new AbortController();
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
        signal: controller.signal
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

  const result = await generateNanoBananaAssistantPrompt(
    {
      apiBaseUrl: settings.apiBaseUrl,
      apiKey: settings.apiKey,
      model: settings.model
    },
    {
      ...input,
      references: preparedReferences,
      signal: controller.signal
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

async function startAnalyzeTask(image: CapturedImage): Promise<TaskState> {
  cancelCurrentTask();

  const taskId = createTaskId("analyze");
  const controller = new AbortController();
  activeController = controller;

  setCurrentTask({
    id: taskId,
    kind: "analyze",
    status: "preparing",
    mode: "single",
    message: "正在准备图片",
    progressPercent: 8,
    progressLabel: "准备任务",
    progressDetail: "正在创建图片反推任务",
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

async function startAnalyzeMultiTask(
  mode: MultiAnalyzeMode,
  images: CapturedImage[]
): Promise<TaskState> {
  if (images.length < 2) {
    throw createAppError("image_not_found", "多图分析至少需要 2 张参考图。");
  }

  cancelCurrentTask();

  const taskId = createTaskId("analyze");
  const controller = new AbortController();
  activeController = controller;

  setCurrentTask({
    id: taskId,
    kind: "analyze",
    status: "preparing",
    mode,
    message:
      mode === "batch"
        ? `正在准备批量分析：${images.length} 张参考图`
        : `正在准备同风格分析：${images.length} 张参考图`,
    progressPercent: 8,
    progressLabel: "准备任务",
    progressDetail: mode === "batch" ? "正在创建批量反推任务" : "正在创建同风格分析任务",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    source: images[0],
    sources: images
  });

  startHeartbeat(taskId);

  const task = mode === "batch"
    ? runAnalyzeBatchTask(taskId, images, controller)
    : runAnalyzeStyleCommonTask(taskId, images, controller);

  void task.finally(() => stopHeartbeat(taskId));

  return currentTask!;
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
    if (currentTask?.id === taskId) {
      activeController = null;
    }
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
    if (currentTask?.id === taskId) {
      activeController = null;
    }
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
    progressPercent: 68,
    progressLabel: "编辑提示词",
    progressDetail: visualReferences.length ? "正在结合视觉参考修改 JSON" : "正在按文本指令修改 JSON",
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
      currentTask?.progressPercent ?? 0,
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
      currentTask?.progressPercent ?? 0,
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
  if (!currentTask || currentTask.id !== taskId) {
    return;
  }

  const timings = [...(currentTask.timings ?? []), timing].slice(-80);
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

  await openFloatingPanelOrSidePanel(activeTab, "open");

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

async function openFloatingPanelOrSidePanel(
  tab?: chrome.tabs.Tab,
  mode: "open" | "toggle" = "open"
): Promise<void> {
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
    url: info.srcUrl ?? "",
    sourcePageUrl: info.pageUrl ?? tab?.url,
    sourceTitle: tab?.title,
    tabId: tab?.id
  };
}

async function addMixImages(images: CapturedImage[]): Promise<CapturedImage[]> {
  await loadMixImages();
  const nextImages = images.filter((image) => image.url.trim());
  const nextUrls = new Set(nextImages.map((image) => image.url));
  const withoutDuplicates = mixImages.filter((image) => !nextUrls.has(image.url));
  mixImages = [...nextImages, ...withoutDuplicates].slice(0, MAX_MIX_IMAGES);
  await saveMixImages(mixImages);
  void broadcastMixUpdated();
  return mixImages;
}

async function setMixImages(images: CapturedImage[]): Promise<CapturedImage[]> {
  mixImages = images.filter(isCapturedImage).slice(0, MAX_MIX_IMAGES);
  await saveMixImages(mixImages);
  void broadcastMixUpdated();
  return mixImages;
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

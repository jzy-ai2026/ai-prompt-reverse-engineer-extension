import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  BookOpen,
  History,
  ImageIcon,
  Loader2,
  MessageSquareText,
  Settings,
  Sparkles,
  Timer
} from "lucide-react";
import { toUserFacingError, type UserFacingError } from "../lib/errors";
import {
  applyFieldAssignment,
  clonePromptDocument,
  createEmptyPromptDocument,
  createStructuredJsonText,
  normalizePromptDocument,
  updatePromptDocumentFromStructuredJsonText,
  type PromptDocument
} from "../lib/promptDocument";
import {
  addHistoryItem,
  getHistory,
  getPromptTemplates,
  getSettings,
  saveSettings,
  type AssistantHistoryItem,
  type ExtensionSettings,
  type HistoryReferenceImage,
  type PromptHistoryItem
} from "../lib/storage";
import type {
  AssistantPromptInput,
  AssistantPromptResult
} from "../lib/openaiClient";
import type { PromptTemplate } from "../lib/promptTemplates";
import { HistoryList } from "./components/HistoryList";
import { ImagePreview } from "./components/ImagePreview";
import {
  InstructionInput,
  type InstructionImageReference
} from "./components/InstructionInput";
import { JsonEditor } from "./components/JsonEditor";
import { PromptPreview } from "./components/PromptPreview";
import { SettingsPanel } from "./components/SettingsPanel";
import { TemplateManager } from "./components/TemplateManager";
import { NanoBananaAssistant } from "./components/NanoBananaAssistant";
import { Tooltip } from "./components/Tooltip";

type ViewMode = "workspace" | "assistant" | "history" | "templates" | "settings";
type ResultView = "prompt" | "json";
type EditMode = "auto" | "text" | "vision";
type ResolvedEditMode = "text" | "vision";
type MultiAnalyzeMode = "style_common" | "batch";

type TaskStatus =
  | "idle"
  | "awaiting_consent"
  | "preparing"
  | "running"
  | "done"
  | "error"
  | "cancelled";

interface CapturedImage {
  url: string;
  sourcePageUrl?: string;
  sourceTitle?: string;
  tabId?: number;
}

interface PreparedImagePayload {
  imageUrl: string;
  sourceImageUrl: string;
  transport: "remote_url" | "data_url";
  width?: number;
  height?: number;
  sizeBytes?: number;
  mimeType?: string;
  wasCompressed: boolean;
}

interface TaskState {
  id: string;
  kind: "analyze" | "edit";
  status: TaskStatus;
  phase?: string;
  message?: string;
  mode?: "single" | MultiAnalyzeMode;
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
  error?: UserFacingError;
}

interface TaskTimingEntry {
  id: string;
  label: string;
  durationMs: number;
  startedAt: string;
  endedAt: string;
  status: "done" | "error";
  detail?: string;
}

interface RuntimeResponse<T> {
  ok: boolean;
  data?: T;
  error?: unknown;
}

interface AssistantGenerateResponse {
  result: AssistantPromptResult;
  history: AssistantHistoryItem[];
}

interface EditVisualReference {
  imageUrl: string;
  sourceImageUrl?: string;
  label?: string;
  sourceTitle?: string;
}

interface EditImageReference extends InstructionImageReference {
  imageUrl: string;
  sourceImageUrl?: string;
}

type BackgroundMessage =
  | { type: "background:task-state"; task: TaskState }
  | {
      type: "background:privacy-consent-request";
      taskId: string;
      source?: CapturedImage;
    }
  | { type: "background:error"; error: UserFacingError }
  | { type: "background:heartbeat"; taskId: string; updatedAt: string }
  | { type: "background:shortcut"; command: string }
  | { type: "background:mix-updated"; images: CapturedImage[] };

interface PendingConsent {
  taskId: string;
  source?: CapturedImage;
}

export function App() {
  const [viewMode, setViewMode] = useState<ViewMode>("workspace");
  const [resultView, setResultView] = useState<ResultView>("prompt");
  const [task, setTask] = useState<TaskState | null>(null);
  const [document, setDocument] = useState<PromptDocument>(() =>
    createEmptyPromptDocument("single")
  );
  const [jsonText, setJsonText] = useState("");
  const [history, setHistory] = useState<PromptHistoryItem[]>([]);
  const [mixImages, setMixImages] = useState<CapturedImage[]>([]);
  const [activeReferenceImages, setActiveReferenceImages] = useState<
    HistoryReferenceImage[]
  >([]);
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [settings, setSettings] = useState<ExtensionSettings | null>(null);
  const [editMode, setEditMode] = useState<EditMode>("auto");
  const [error, setError] = useState<UserFacingError | null>(null);
  const [pendingConsent, setPendingConsent] = useState<PendingConsent | null>(null);
  const [undoStack, setUndoStack] = useState<PromptDocument[]>([]);
  const [redoStack, setRedoStack] = useState<PromptDocument[]>([]);
  const [isSavingHistory, setIsSavingHistory] = useState(false);
  const savedTaskIds = useRef(new Set<string>());
  const activeReferenceImagesRef = useRef<HistoryReferenceImage[]>([]);

  const isBusy =
    task?.status === "awaiting_consent" ||
    task?.status === "preparing" ||
    task?.status === "running";

  const statusText = useMemo(() => {
    if (!task) {
      return "等待选择图片";
    }

    return task.message || task.phase || task.status;
  }, [task]);

  const statusLabel = useMemo(() => {
    if (isBusy) {
      return "处理中";
    }

    if (task?.status === "done") {
      return "已生成";
    }

    if (task?.status === "error") {
      return "需处理";
    }

    return "待开始";
  }, [isBusy, task?.status]);

  const selectedTemplate = useMemo(
    () =>
      templates.find(
        (template) => template.id === settings?.selectedPromptTemplateId
      ) ?? templates[0],
    [settings?.selectedPromptTemplateId, templates]
  );

  const editImageReferences = useMemo(
    () => createEditImageReferences(task, mixImages, activeReferenceImages),
    [activeReferenceImages, mixImages, task]
  );
  const hasVisualEditContext = editImageReferences.length > 0;
  const previewContext = useMemo(
    () => createPreviewImageContext(task, activeReferenceImages),
    [activeReferenceImages, task]
  );

  const updateActiveReferenceImages = useCallback(
    (images: HistoryReferenceImage[]) => {
      const nextImages = images.slice(0, 6);
      activeReferenceImagesRef.current = nextImages;
      setActiveReferenceImages(nextImages);
    },
    []
  );

  const setActiveDocument = useCallback(
    (nextDocument: PromptDocument, options: { pushUndo?: boolean } = {}) => {
      setDocument((current) => {
        if (options.pushUndo) {
          setUndoStack((stack) => [clonePromptDocument(current), ...stack].slice(0, 50));
          setRedoStack([]);
        }

        return nextDocument;
      });
      setJsonText(createStructuredJsonText(nextDocument));
    },
    []
  );

  const refreshHistory = useCallback(async () => {
    try {
      setHistory(await getHistory());
    } catch {
      setHistory([]);
    }
  }, []);

  const refreshTemplateState = useCallback(async () => {
    try {
      const [loadedSettings, loadedTemplates] = await Promise.all([
        getSettings(),
        getPromptTemplates()
      ]);
      setSettings(loadedSettings);
      setTemplates(loadedTemplates);
    } catch {
      setTemplates([]);
    }
  }, []);

  const saveCurrentToHistory = useCallback(async () => {
    setIsSavingHistory(true);

    try {
      setHistory(
        await addHistoryItem({
          document,
          sourcePageUrl: task?.source?.sourcePageUrl,
          sourceTitle: task?.source?.sourceTitle,
          thumbnail:
            activeReferenceImages[0]?.thumbnail ??
            activeReferenceImages[0]?.url ??
            task?.source?.url,
          referenceImages:
            activeReferenceImages.length > 0
              ? activeReferenceImages
              : createReferenceImagesFromTask(task)
        })
      );
    } finally {
      setIsSavingHistory(false);
    }
  }, [activeReferenceImages, document, task]);

  const handleTaskState = useCallback(
    (nextTask: TaskState) => {
      setTask(nextTask);
      const taskReferenceImages = createReferenceImagesFromTask(nextTask);

      if (taskReferenceImages.length) {
        updateActiveReferenceImages(taskReferenceImages);
      }

      if (nextTask.status === "error" && nextTask.error) {
        setError(nextTask.error);
      }

      if (nextTask.status === "done" && nextTask.document) {
        const nextDocument = normalizePromptDocument(nextTask.document);

        setError(null);
        setPendingConsent(null);
        setActiveDocument(nextDocument, { pushUndo: true });

        if (nextTask.historySaved) {
          void refreshHistory();
          return;
        }

        if (!savedTaskIds.current.has(nextTask.id)) {
          savedTaskIds.current.add(nextTask.id);
          const historyReferenceImages = taskReferenceImages.length
            ? taskReferenceImages
            : activeReferenceImagesRef.current;

          void addHistoryItem({
            document: nextDocument,
            sourcePageUrl: nextTask.source?.sourcePageUrl,
            sourceTitle: nextTask.source?.sourceTitle,
            thumbnail:
              historyReferenceImages[0]?.thumbnail ??
              historyReferenceImages[0]?.url ??
              nextTask.source?.url,
            referenceImages: historyReferenceImages
          }).then(setHistory);
        }
      }
    },
    [refreshHistory, setActiveDocument, updateActiveReferenceImages]
  );

  const handleShortcut = useCallback(
    (command: string) => {
      if (command === "copy-current-json") {
        void navigator.clipboard.writeText(jsonText);
      }

      if (command === "save-current-prompt") {
        void saveCurrentToHistory();
      }
    },
    [jsonText, saveCurrentToHistory]
  );

  useEffect(() => {
    setJsonText(createStructuredJsonText(document));
  }, []);

  useEffect(() => {
    void sendRuntimeMessage<TaskState | null>({ type: "panel:get-state" })
      .then((state) => {
        if (state) {
          handleTaskState(state);
        }
      })
      .catch(() => undefined);
    void sendRuntimeMessage<CapturedImage[]>({ type: "panel:get-mix" })
      .then(setMixImages)
      .catch(() => undefined);
    void refreshHistory();
    void refreshTemplateState();
  }, [handleTaskState, refreshHistory, refreshTemplateState]);

  useEffect(() => {
    if (!hasExtensionRuntime()) {
      return undefined;
    }

    const listener = (message: BackgroundMessage) => {
      if (message.type === "background:task-state") {
        handleTaskState(message.task);
        return;
      }

      if (message.type === "background:privacy-consent-request") {
        setPendingConsent({
          taskId: message.taskId,
          source: message.source
        });
        return;
      }

      if (message.type === "background:error") {
        setError(message.error);
        return;
      }

      if (message.type === "background:mix-updated") {
        setMixImages(message.images);
        setError(null);
        return;
      }

      if (message.type === "background:shortcut") {
        handleShortcut(message.command);
      }
    };

    chrome.runtime.onMessage.addListener(listener);

    return () => {
      chrome.runtime.onMessage.removeListener(listener);
    };
  }, [handleShortcut, handleTaskState]);

  const handleJsonChange = useCallback(
    (nextText: string) => {
      setJsonText(nextText);

      try {
        setActiveDocument(
          updatePromptDocumentFromStructuredJsonText(document, nextText),
          { pushUndo: true }
        );
        setError(null);
      } catch {
        setError({
          code: "model_json_parse_error",
          title: "JSON 格式错误",
          message: "当前 JSON 尚未解析成功，修正后会自动更新 Prompt 预览。",
          canRetry: false
        });
      }
    },
    [document, setActiveDocument]
  );

  const handleInstructionSubmit = useCallback(
    async (
      instruction: string,
      resolvedMode: ResolvedEditMode,
      referencedImageIndexes: number[]
    ) => {
      const localEdit = applyFieldAssignment(document, instruction);

      if (localEdit && resolvedMode === "text") {
        setActiveDocument(localEdit, { pushUndo: true });
        setError(null);
        return;
      }

      try {
        await sendRuntimeMessage<TaskState>({
          type: "panel:edit-prompt",
          document,
          instruction,
          visualReferences:
            resolvedMode === "vision"
              ? collectVisualReferences(editImageReferences, referencedImageIndexes)
              : undefined
        });
      } catch (caught) {
        setError(toUserFacingError(caught));
      }
    },
    [document, editImageReferences, setActiveDocument]
  );

  const handleConsent = useCallback(
    async (granted: boolean, remember: boolean) => {
      if (!pendingConsent) {
        return;
      }

      await sendRuntimeMessage({
        type: "panel:privacy-consent-response",
        taskId: pendingConsent.taskId,
        granted,
        remember
      });
      setPendingConsent(null);
    },
    [pendingConsent]
  );

  const cancelTask = useCallback(async () => {
    await sendRuntimeMessage({
      type: "panel:cancel-task",
      taskId: task?.id
    });
  }, [task?.id]);

  const analyzeMulti = useCallback(async (mode: MultiAnalyzeMode) => {
    try {
      setError(null);
      await sendRuntimeMessage<TaskState>({
        type: "panel:analyze-multi",
        mode,
        images: mixImages
      });
    } catch (caught) {
      setError(toUserFacingError(caught));
    }
  }, [mixImages]);

  const restoreHistoryItem = useCallback(
    (item: PromptHistoryItem) => {
      const nextDocument = normalizePromptDocument(item.document);
      const referenceImages = (item.referenceImages ?? []).slice(0, 6);
      const restoredMixImages =
        referenceImages.length > 1 &&
        (nextDocument.source.type === "style_common" ||
          nextDocument.source.type === "mix")
          ? referenceImages.map(historyReferenceToCapturedImage).filter(isCapturedImage)
          : [];
      const restoredSources = referenceImages
        .map(historyReferenceToCapturedImage)
        .filter(isCapturedImage);
      const restoredPreparedImages = referenceImages
        .map(historyReferenceToPreparedImage)
        .filter(isPreparedImagePayload);

      updateActiveReferenceImages(referenceImages);
      setMixImages(restoredMixImages);
      syncMixImages(restoredMixImages);
      setTask({
        id: `history_${item.id}`,
        kind: "analyze",
        status: "done",
        mode: sourceTypeToTaskMode(nextDocument.source.type),
        message: "已从历史恢复",
        createdAt: item.createdAt,
        updatedAt: new Date().toISOString(),
        source: restoredSources[0],
        sources: restoredSources,
        preparedImage: restoredPreparedImages[0],
        preparedImages: restoredPreparedImages,
        referenceImages,
        document: nextDocument,
        historySaved: true
      });
      setActiveDocument(nextDocument, { pushUndo: true });
      setError(null);
      setPendingConsent(null);
      setViewMode("workspace");
    },
    [setActiveDocument, updateActiveReferenceImages]
  );

  const removeMixImage = useCallback(async (url: string) => {
    if (!hasExtensionRuntime()) {
      setMixImages((current) => current.filter((image) => image.url !== url));
      return;
    }

    setMixImages(
      await sendRuntimeMessage<CapturedImage[]>({
        type: "panel:remove-mix-image",
        url
      })
    );
  }, []);

  const clearMixImages = useCallback(async () => {
    if (!hasExtensionRuntime()) {
      setMixImages([]);
      return;
    }

    setMixImages(await sendRuntimeMessage<CapturedImage[]>({ type: "panel:clear-mix" }));
  }, []);

  const addMixImages = useCallback(async (images: CapturedImage[]) => {
    try {
      setError(null);

      if (!hasExtensionRuntime()) {
        setMixImages((current) => {
          const nextUrls = new Set(images.map((image) => image.url));
          const withoutDuplicates = current.filter((image) => !nextUrls.has(image.url));
          return [...images, ...withoutDuplicates].slice(0, 6);
        });
        return;
      }

      setMixImages(
        await sendRuntimeMessage<CapturedImage[]>({
          type: "panel:add-mix-images",
          images
        })
      );
    } catch (caught) {
      setError(toUserFacingError(caught));
    }
  }, []);

  const generateAssistantPrompt = useCallback(
    async (input: AssistantPromptInput): Promise<AssistantGenerateResponse> => {
      if (!hasExtensionRuntime()) {
        throw new Error("Extension runtime is unavailable in local preview.");
      }

      return sendRuntimeMessage<AssistantGenerateResponse>({
        type: "panel:generate-assistant-prompt",
        input
      });
    },
    []
  );

  const getAssistantPromptHistory = useCallback(async () => {
    if (!hasExtensionRuntime()) {
      return [] satisfies AssistantHistoryItem[];
    }

    return sendRuntimeMessage<AssistantHistoryItem[]>({
      type: "panel:get-assistant-history"
    });
  }, []);

  const removeAssistantPromptHistory = useCallback(async (id: string) => {
    if (!hasExtensionRuntime()) {
      return [] satisfies AssistantHistoryItem[];
    }

    return sendRuntimeMessage<AssistantHistoryItem[]>({
      type: "panel:remove-assistant-history",
      id
    });
  }, []);

  const clearAssistantPromptHistory = useCallback(async () => {
    if (!hasExtensionRuntime()) {
      return;
    }

    await sendRuntimeMessage<AssistantHistoryItem[]>({
      type: "panel:clear-assistant-history"
    });
  }, []);

  const changeTemplate = useCallback(async (templateId: string) => {
    setSettings((current) =>
      current ? { ...current, selectedPromptTemplateId: templateId } : current
    );

    try {
      setSettings(await saveSettings({ selectedPromptTemplateId: templateId }));
    } catch (caught) {
      setError(toUserFacingError(caught));
    }
  }, []);

  const undo = useCallback(() => {
    const previous = undoStack[0];

    if (!previous) {
      return;
    }

    setRedoStack((stack) => [clonePromptDocument(document), ...stack].slice(0, 50));
    setUndoStack((stack) => stack.slice(1));
    setActiveDocument(previous);
  }, [document, setActiveDocument, undoStack]);

  const redo = useCallback(() => {
    const next = redoStack[0];

    if (!next) {
      return;
    }

    setUndoStack((stack) => [clonePromptDocument(document), ...stack].slice(0, 50));
    setRedoStack((stack) => stack.slice(1));
    setActiveDocument(next);
  }, [document, redoStack, setActiveDocument]);

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <div className="eyebrow">Prompt Reverse Engineer</div>
          <h1>图片提示词反推</h1>
          <span className="version-pill">v0.3 专业工作台</span>
        </div>
        <nav className="icon-tabs" aria-label="面板切换">
          <Tooltip content="图片反推工作区" side="bottom">
            <button
              className={viewMode === "workspace" ? "active" : ""}
              type="button"
              onClick={() => setViewMode("workspace")}
            >
              <Sparkles size={18} />
            </button>
          </Tooltip>
          <Tooltip content="Nano Banana Pro 提示词助手" side="bottom">
            <button
              className={viewMode === "assistant" ? "active" : ""}
              type="button"
              onClick={() => setViewMode("assistant")}
            >
              <MessageSquareText size={18} />
            </button>
          </Tooltip>
          <Tooltip content="查看和恢复历史提示词" side="bottom">
            <button
              className={viewMode === "history" ? "active" : ""}
              type="button"
              onClick={() => setViewMode("history")}
            >
              <History size={18} />
            </button>
          </Tooltip>
          <Tooltip content="管理反推模板" side="bottom">
            <button
              className={viewMode === "templates" ? "active" : ""}
              type="button"
              onClick={() => setViewMode("templates")}
            >
              <BookOpen size={18} />
            </button>
          </Tooltip>
          <Tooltip content="配置 API 网关和模型" side="bottom">
            <button
              className={viewMode === "settings" ? "active" : ""}
              type="button"
              onClick={() => setViewMode("settings")}
            >
              <Settings size={18} />
            </button>
          </Tooltip>
        </nav>
      </header>

      {viewMode === "workspace" && (
        <main className="workspace">
          <section className="workspace-hero" aria-label="当前工作流状态">
            <div>
              <span className="hero-kicker">IMAGE TO PROMPT</span>
              <h2>把参考图整理成可控 Prompt</h2>
            </div>
            <div className="hero-metrics" aria-label="工作流概览">
              <span>
                <ImageIcon size={14} />
                {mixImages.length ? `${mixImages.length} 张参考` : "单图分析"}
              </span>
              <span>{statusLabel}</span>
            </div>
          </section>

          <div className="workspace-grid">
            <div className="workspace-column workspace-input-column">
              <section className="status-strip" data-status={task?.status ?? "idle"}>
                {isBusy && <Loader2 className="spin" size={16} />}
                {!isBusy && task?.status === "error" && <AlertCircle size={16} />}
                <span>{statusText}</span>
                {isBusy && (
                  <button type="button" onClick={cancelTask}>
                    取消
                  </button>
                )}
              </section>

              <section className="template-strip">
                <div>
                  <strong>{selectedTemplate?.name ?? "默认模板"}</strong>
                  <span>{selectedTemplate?.description ?? "选择本次反推使用的提示词模板"}</span>
                </div>
                <select
                  value={settings?.selectedPromptTemplateId ?? selectedTemplate?.id ?? ""}
                  onChange={(event) => changeTemplate(event.target.value)}
                  disabled={!templates.length || isBusy}
                >
                  {templates.map((template) => (
                    <option value={template.id} key={template.id}>
                      {template.name}
                    </option>
                  ))}
                </select>
              </section>

              {error && (
                <section className="error-panel">
                  <strong>{error.title}</strong>
                  <p>{error.message}</p>
                  {error.detail && <small>{error.detail}</small>}
                </section>
              )}

              {pendingConsent && (
                <section className="consent-panel">
                  <strong>允许发送图片/URL 到 API 服务？</strong>
                  <p>图片或图片 URL 将发送至你配置的 API 服务，用于视觉模型分析。</p>
                  <div className="button-row">
                    <button type="button" onClick={() => handleConsent(true, false)}>
                      本次允许
                    </button>
                    <button type="button" onClick={() => handleConsent(true, true)}>
                      记住选择
                    </button>
                    <button
                      className="secondary"
                      type="button"
                      onClick={() => handleConsent(false, false)}
                    >
                      取消
                    </button>
                  </div>
                </section>
              )}

              <ImagePreview
                source={previewContext.source}
                preparedImage={previewContext.preparedImage}
                mixImages={mixImages}
                isLoading={isBusy && task?.kind === "analyze"}
                progressPercent={task?.progressPercent}
                progressLabel={task?.progressLabel}
                progressDetail={task?.progressDetail ?? statusText}
                onAnalyze={(image) =>
                  sendRuntimeMessage({ type: "panel:analyze-image", image })
                }
                onAnalyzeMulti={analyzeMulti}
                onAddMixImages={addMixImages}
                onRemoveMixImage={removeMixImage}
                onClearMixImages={clearMixImages}
              />
            </div>

            <div className="workspace-column workspace-output-column">
              <div className="result-tabs" role="tablist" aria-label="结果视图">
                <Tooltip content="查看可直接复制使用的提示词">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={resultView === "prompt"}
                    className={resultView === "prompt" ? "active" : ""}
                    onClick={() => setResultView("prompt")}
                  >
                    Prompt
                  </button>
                </Tooltip>
                <Tooltip content="查看和手动编辑结构化 JSON">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={resultView === "json"}
                    className={resultView === "json" ? "active" : ""}
                    onClick={() => setResultView("json")}
                  >
                    JSON
                  </button>
                </Tooltip>
              </div>

              {resultView === "prompt" ? (
                <PromptPreview
                  document={document}
                  onSave={saveCurrentToHistory}
                  isSaving={isSavingHistory}
                />
              ) : (
                <JsonEditor
                  value={jsonText}
                  onChange={handleJsonChange}
                  onUndo={undo}
                  onRedo={redo}
                  canUndo={undoStack.length > 0}
                  canRedo={redoStack.length > 0}
                />
              )}
            </div>
          </div>

          {task?.timings?.length ? <TimingBreakdown task={task} /> : null}

          <InstructionInput
            disabled={isBusy}
            mode={editMode}
            hasVisualContext={hasVisualEditContext}
            imageReferences={editImageReferences}
            onModeChange={setEditMode}
            onSubmit={handleInstructionSubmit}
          />
        </main>
      )}

      {viewMode === "assistant" && (
        <NanoBananaAssistant
          mixImages={mixImages}
          disabled={isBusy}
          onGenerate={generateAssistantPrompt}
          onGetHistory={getAssistantPromptHistory}
          onRemoveHistory={removeAssistantPromptHistory}
          onClearHistory={clearAssistantPromptHistory}
        />
      )}

      {viewMode === "history" && (
        <HistoryList
          items={history}
          onRefresh={refreshHistory}
          onSelect={restoreHistoryItem}
          onChanged={setHistory}
        />
      )}

      {viewMode === "templates" && (
        <TemplateManager
          templates={templates}
          selectedTemplateId={settings?.selectedPromptTemplateId ?? ""}
          onTemplatesChanged={setTemplates}
          onSelectedTemplateChange={changeTemplate}
        />
      )}

      {viewMode === "settings" && <SettingsPanel />}
    </div>
  );
}

function collectVisualReferences(
  references: EditImageReference[],
  referencedImageIndexes: number[]
): EditVisualReference[] {
  const selectedIndexes = new Set(referencedImageIndexes);
  const selectedReferences = selectedIndexes.size
    ? references.filter((reference) => selectedIndexes.has(reference.index))
    : references;

  return selectedReferences.map((reference) => ({
    imageUrl: reference.imageUrl,
    sourceImageUrl: reference.sourceImageUrl,
    label: reference.label,
    sourceTitle: reference.sourceTitle
  }));
}

function TimingBreakdown({ task }: { task: TaskState }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const timings = task.timings ?? [];
  const totalDuration = getTaskWallClockDuration(task);
  const slowest = timings.reduce<TaskTimingEntry>(
    (current, timing) =>
      !current || timing.durationMs > current.durationMs ? timing : current,
    {
      id: "timing_empty",
      label: "暂无",
      durationMs: 0,
      startedAt: task.createdAt,
      endedAt: task.updatedAt,
      status: "done"
    }
  );

  return (
    <section className="timing-panel compact" data-expanded={isExpanded}>
      <Tooltip content="查看每个处理步骤的耗时">
        <button
          className="timing-summary-button"
          type="button"
          aria-expanded={isExpanded}
          onClick={() => setIsExpanded((current) => !current)}
        >
          <strong>
            <Timer size={14} />
            耗时诊断
          </strong>
          <span>{formatDuration(totalDuration)}</span>
          {slowest && (
            <small>
              最慢：{slowest.label} {formatDuration(slowest.durationMs)}
            </small>
          )}
        </button>
      </Tooltip>
      {isExpanded && (
        <div className="timing-list">
          {timings.map((timing) => (
            <div className="timing-row" data-status={timing.status} key={timing.id}>
              <span>{timing.label}</span>
              <strong>{formatDuration(timing.durationMs)}</strong>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function getTaskWallClockDuration(task: TaskState): number {
  const startedAt = new Date(task.createdAt).getTime();
  const endedAt = new Date(task.updatedAt).getTime();

  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt)) {
    return task.timings?.reduce((total, timing) => total + timing.durationMs, 0) ?? 0;
  }

  return Math.max(0, endedAt - startedAt);
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) {
    return `${Math.round(durationMs)}ms`;
  }

  if (durationMs < 60_000) {
    return `${(durationMs / 1000).toFixed(durationMs < 10_000 ? 1 : 0)}s`;
  }

  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.round((durationMs % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

function createEditImageReferences(
  task: TaskState | null,
  mixImages: CapturedImage[],
  activeReferenceImages: HistoryReferenceImage[]
): EditImageReference[] {
  if (mixImages.length) {
    return mixImages.map((image, index) => {
      const prepared = task?.preparedImages?.[index];

      return {
        index: index + 1,
        label: `@图片${index + 1}`,
        thumbnail: image.url,
        imageUrl: prepared?.imageUrl ?? image.url,
        sourceImageUrl: prepared?.sourceImageUrl ?? image.url,
        sourceTitle: image.sourceTitle
      };
    });
  }

  if (task?.preparedImages?.length) {
    return task.preparedImages.map((image, index) => ({
      index: index + 1,
      label: `@图片${index + 1}`,
      thumbnail: image.imageUrl,
      imageUrl: image.imageUrl,
      sourceImageUrl: image.sourceImageUrl,
      sourceTitle: task.sources?.[index]?.sourceTitle
    }));
  }

  if (task?.preparedImage) {
    return [
      {
        index: 1,
        label: "@图片1",
        thumbnail: task.preparedImage.imageUrl,
        imageUrl: task.preparedImage.imageUrl,
        sourceImageUrl: task.preparedImage.sourceImageUrl,
        sourceTitle: task.source?.sourceTitle
      }
    ];
  }

  if (task?.source) {
    return [
      {
        index: 1,
        label: "@图片1",
        thumbnail: task.source.url,
        imageUrl: task.source.url,
        sourceImageUrl: task.source.url,
        sourceTitle: task.source.sourceTitle
      }
    ];
  }

  if (activeReferenceImages.length) {
    const references: EditImageReference[] = [];

    activeReferenceImages.forEach((reference, index) => {
      const imageUrl = getReferenceImageUrl(reference);

      if (!imageUrl) {
        return;
      }

      references.push({
        index: index + 1,
        label: `@图片${index + 1}`,
        thumbnail: reference.thumbnail ?? imageUrl,
        imageUrl,
        sourceImageUrl: reference.sourceImageUrl ?? imageUrl,
        sourceTitle: reference.sourceTitle
      });
    });

    return references;
  }

  return [];
}

function createPreviewImageContext(
  task: TaskState | null,
  activeReferenceImages: HistoryReferenceImage[]
): { source?: CapturedImage; preparedImage?: PreparedImagePayload } {
  if (task?.source || task?.preparedImage) {
    return {
      source: task.source,
      preparedImage: task.preparedImage
    };
  }

  const firstReference = activeReferenceImages[0];

  if (!firstReference) {
    return {};
  }
  const source = historyReferenceToCapturedImage(firstReference) ?? undefined;
  const preparedImage = historyReferenceToPreparedImage(firstReference) ?? undefined;

  return {
    source,
    preparedImage
  };
}

function createReferenceImagesFromTask(
  task: TaskState | null
): HistoryReferenceImage[] {
  if (!task) {
    return [];
  }

  if (task.referenceImages?.length) {
    return task.referenceImages.slice(0, 6);
  }

  const preparedImages = task.preparedImages?.length
    ? task.preparedImages
    : task.preparedImage
      ? [task.preparedImage]
      : [];
  const sources = task.sources?.length ? task.sources : task.source ? [task.source] : [];
  const count = Math.max(preparedImages.length, sources.length);

  return Array.from({ length: Math.min(count, 6) }, (_, index) => {
    const preparedImage = preparedImages[index];
    const source = sources[index];
    const imageUrl = preparedImage?.imageUrl ?? source?.url;

    return {
      id: `img_${String(index + 1).padStart(3, "0")}`,
      url: imageUrl,
      sourceImageUrl: preparedImage?.sourceImageUrl ?? source?.url,
      sourcePageUrl: source?.sourcePageUrl,
      sourceTitle: source?.sourceTitle,
      thumbnail: imageUrl,
      width: preparedImage?.width,
      height: preparedImage?.height
    };
  }).filter((reference) => Boolean(reference.url || reference.sourceImageUrl));
}

function historyReferenceToCapturedImage(
  reference: HistoryReferenceImage
): CapturedImage | null {
  const imageUrl = getReferenceImageUrl(reference);

  if (!imageUrl) {
    return null;
  }

  return {
    url: imageUrl,
    sourcePageUrl: reference.sourcePageUrl,
    sourceTitle: reference.sourceTitle
  };
}

function historyReferenceToPreparedImage(
  reference: HistoryReferenceImage
): PreparedImagePayload | null {
  const imageUrl = getReferenceImageUrl(reference);

  if (!imageUrl) {
    return null;
  }

  return {
    imageUrl,
    sourceImageUrl: reference.sourceImageUrl ?? imageUrl,
    transport: imageUrl.startsWith("data:image/") ? "data_url" : "remote_url",
    width: reference.width,
    height: reference.height,
    wasCompressed: imageUrl.startsWith("data:image/")
  };
}

function getReferenceImageUrl(reference: HistoryReferenceImage): string | undefined {
  return reference.url ?? reference.thumbnail ?? reference.sourceImageUrl;
}

function isCapturedImage(value: CapturedImage | null): value is CapturedImage {
  return Boolean(value?.url);
}

function isPreparedImagePayload(
  value: PreparedImagePayload | null
): value is PreparedImagePayload {
  return Boolean(value?.imageUrl);
}

function sourceTypeToTaskMode(
  sourceType: PromptDocument["source"]["type"]
): "single" | MultiAnalyzeMode {
  if (sourceType === "style_common" || sourceType === "mix") {
    return "style_common";
  }

  if (sourceType === "batch") {
    return "batch";
  }

  return "single";
}

function syncMixImages(images: CapturedImage[]): void {
  if (!hasExtensionRuntime()) {
    return;
  }

  void sendRuntimeMessage<CapturedImage[]>({
    type: "panel:set-mix-images",
    images
  }).catch(() => undefined);
}

async function sendRuntimeMessage<T>(message: unknown): Promise<T> {
  if (!hasExtensionRuntime()) {
    if (
      isRuntimeMessageType(message, "panel:get-state") ||
      isRuntimeMessageType(message, "panel:get-mix")
    ) {
      return (isRuntimeMessageType(message, "panel:get-mix") ? [] : null) as T;
    }

    throw new Error("Extension runtime is unavailable in local preview.");
  }

  const response = (await chrome.runtime.sendMessage(message)) as RuntimeResponse<T>;

  if (!response?.ok) {
    throw response?.error ?? new Error("Runtime message failed.");
  }

  return response.data as T;
}

function hasExtensionRuntime(): boolean {
  return typeof chrome !== "undefined" && Boolean(chrome.runtime?.sendMessage);
}

function isRuntimeMessageType(message: unknown, type: string): boolean {
  return (
    typeof message === "object" &&
    message !== null &&
    "type" in message &&
    (message as { type?: unknown }).type === type
  );
}

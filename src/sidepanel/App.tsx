import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, BookOpen, History, Loader2, Settings, Sparkles } from "lucide-react";
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
  type ExtensionSettings,
  type PromptHistoryItem
} from "../lib/storage";
import type { PromptTemplate } from "../lib/promptTemplates";
import { HistoryList } from "./components/HistoryList";
import { ImagePreview } from "./components/ImagePreview";
import { InstructionInput } from "./components/InstructionInput";
import { JsonEditor } from "./components/JsonEditor";
import { PromptPreview } from "./components/PromptPreview";
import { SettingsPanel } from "./components/SettingsPanel";
import { TemplateManager } from "./components/TemplateManager";

type ViewMode = "workspace" | "history" | "templates" | "settings";
type ResultView = "prompt" | "json";
type EditMode = "auto" | "text" | "vision";
type ResolvedEditMode = "text" | "vision";

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
  createdAt: string;
  updatedAt: string;
  source?: CapturedImage;
  sources?: CapturedImage[];
  preparedImage?: PreparedImagePayload;
  preparedImages?: PreparedImagePayload[];
  document?: PromptDocument;
  rawText?: string;
  usedJsonMode?: boolean;
  error?: UserFacingError;
}

interface RuntimeResponse<T> {
  ok: boolean;
  data?: T;
  error?: unknown;
}

interface EditVisualReference {
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
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [settings, setSettings] = useState<ExtensionSettings | null>(null);
  const [editMode, setEditMode] = useState<EditMode>("auto");
  const [error, setError] = useState<UserFacingError | null>(null);
  const [pendingConsent, setPendingConsent] = useState<PendingConsent | null>(null);
  const [undoStack, setUndoStack] = useState<PromptDocument[]>([]);
  const [redoStack, setRedoStack] = useState<PromptDocument[]>([]);
  const [isSavingHistory, setIsSavingHistory] = useState(false);
  const savedTaskIds = useRef(new Set<string>());

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

  const selectedTemplate = useMemo(
    () =>
      templates.find(
        (template) => template.id === settings?.selectedPromptTemplateId
      ) ?? templates[0],
    [settings?.selectedPromptTemplateId, templates]
  );

  const hasVisualEditContext = Boolean(
    task?.preparedImages?.length || task?.preparedImage
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
            task?.preparedImages?.[0]?.transport === "data_url"
              ? task.preparedImages[0].imageUrl
              : task?.preparedImage?.transport === "data_url"
                ? task.preparedImage.imageUrl
              : task?.source?.url
        })
      );
    } finally {
      setIsSavingHistory(false);
    }
  }, [document, task]);

  const handleTaskState = useCallback(
    (nextTask: TaskState) => {
      setTask(nextTask);

      if (nextTask.status === "error" && nextTask.error) {
        setError(nextTask.error);
      }

      if (nextTask.status === "done" && nextTask.document) {
        const nextDocument = normalizePromptDocument(nextTask.document);

        setError(null);
        setPendingConsent(null);
        setActiveDocument(nextDocument, { pushUndo: true });

        if (!savedTaskIds.current.has(nextTask.id)) {
          savedTaskIds.current.add(nextTask.id);
          void addHistoryItem({
            document: nextDocument,
            sourcePageUrl: nextTask.source?.sourcePageUrl,
            sourceTitle: nextTask.source?.sourceTitle,
            thumbnail:
              nextTask.preparedImages?.[0]?.transport === "data_url"
                ? nextTask.preparedImages[0].imageUrl
                : nextTask.preparedImage?.transport === "data_url"
                  ? nextTask.preparedImage.imageUrl
                : nextTask.source?.url
          }).then(setHistory);
        }
      }
    },
    [setActiveDocument]
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
    async (instruction: string, resolvedMode: ResolvedEditMode) => {
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
            resolvedMode === "vision" ? collectVisualReferences(task) : undefined
        });
      } catch (caught) {
        setError(toUserFacingError(caught));
      }
    },
    [document, setActiveDocument, task]
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

  const analyzeMix = useCallback(async () => {
    try {
      setError(null);
      await sendRuntimeMessage<TaskState>({
        type: "panel:analyze-mix",
        images: mixImages
      });
    } catch (caught) {
      setError(toUserFacingError(caught));
    }
  }, [mixImages]);

  const removeMixImage = useCallback(async (url: string) => {
    setMixImages(
      await sendRuntimeMessage<CapturedImage[]>({
        type: "panel:remove-mix-image",
        url
      })
    );
  }, []);

  const clearMixImages = useCallback(async () => {
    setMixImages(await sendRuntimeMessage<CapturedImage[]>({ type: "panel:clear-mix" }));
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
          <span className="version-pill">v0.2 专业工作台</span>
        </div>
        <nav className="icon-tabs" aria-label="面板切换">
          <button
            className={viewMode === "workspace" ? "active" : ""}
            title="工作区"
            type="button"
            onClick={() => setViewMode("workspace")}
          >
            <Sparkles size={18} />
          </button>
          <button
            className={viewMode === "history" ? "active" : ""}
            title="历史记录"
            type="button"
            onClick={() => setViewMode("history")}
          >
            <History size={18} />
          </button>
          <button
            className={viewMode === "templates" ? "active" : ""}
            title="模板"
            type="button"
            onClick={() => setViewMode("templates")}
          >
            <BookOpen size={18} />
          </button>
          <button
            className={viewMode === "settings" ? "active" : ""}
            title="设置"
            type="button"
            onClick={() => setViewMode("settings")}
          >
            <Settings size={18} />
          </button>
        </nav>
      </header>

      {viewMode === "workspace" && (
        <main className="workspace">
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
                  <strong>模板切换</strong>
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
                source={task?.source}
                preparedImage={task?.preparedImage}
                mixImages={mixImages}
                onAnalyze={(image) =>
                  sendRuntimeMessage({ type: "panel:analyze-image", image })
                }
                onAnalyzeMix={analyzeMix}
                onRemoveMixImage={removeMixImage}
                onClearMixImages={clearMixImages}
              />
            </div>

            <div className="workspace-column workspace-output-column">
              <div className="result-tabs" role="tablist" aria-label="结果视图">
                <button
                  type="button"
                  role="tab"
                  aria-selected={resultView === "prompt"}
                  className={resultView === "prompt" ? "active" : ""}
                  onClick={() => setResultView("prompt")}
                >
                  Prompt
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={resultView === "json"}
                  className={resultView === "json" ? "active" : ""}
                  onClick={() => setResultView("json")}
                >
                  JSON
                </button>
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

          <InstructionInput
            disabled={isBusy}
            mode={editMode}
            hasVisualContext={hasVisualEditContext}
            onModeChange={setEditMode}
            onSubmit={handleInstructionSubmit}
          />
        </main>
      )}

      {viewMode === "history" && (
        <HistoryList
          items={history}
          onRefresh={refreshHistory}
          onSelect={(item) => {
            setActiveDocument(item.document, { pushUndo: true });
            setViewMode("workspace");
          }}
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

function collectVisualReferences(task: TaskState | null): EditVisualReference[] {
  if (!task) {
    return [];
  }

  if (task.preparedImages?.length) {
    return task.preparedImages.map((image) => ({
      imageUrl: image.imageUrl,
      sourceImageUrl: image.sourceImageUrl
    }));
  }

  if (task.preparedImage) {
    return [
      {
        imageUrl: task.preparedImage.imageUrl,
        sourceImageUrl: task.preparedImage.sourceImageUrl
      }
    ];
  }

  return [];
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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, History, Loader2, Settings, Sparkles } from "lucide-react";
import { toUserFacingError, type UserFacingError } from "../lib/errors";
import {
  applyFieldAssignment,
  clonePromptDocument,
  createEmptyPromptDocument,
  type PromptDocument
} from "../lib/promptDocument";
import {
  addHistoryItem,
  getHistory,
  type PromptHistoryItem
} from "../lib/storage";
import { HistoryList } from "./components/HistoryList";
import { ImagePreview } from "./components/ImagePreview";
import { InstructionInput } from "./components/InstructionInput";
import { JsonEditor } from "./components/JsonEditor";
import { PromptPreview } from "./components/PromptPreview";
import { SettingsPanel } from "./components/SettingsPanel";

type ViewMode = "workspace" | "history" | "settings";

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
  preparedImage?: PreparedImagePayload;
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
  | { type: "background:placeholder"; feature: string; message: string };

interface PendingConsent {
  taskId: string;
  source?: CapturedImage;
}

export function App() {
  const [viewMode, setViewMode] = useState<ViewMode>("workspace");
  const [task, setTask] = useState<TaskState | null>(null);
  const [document, setDocument] = useState<PromptDocument>(() =>
    createEmptyPromptDocument("single")
  );
  const [jsonText, setJsonText] = useState("");
  const [history, setHistory] = useState<PromptHistoryItem[]>([]);
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

  const setActiveDocument = useCallback(
    (nextDocument: PromptDocument, options: { pushUndo?: boolean } = {}) => {
      setDocument((current) => {
        if (options.pushUndo) {
          setUndoStack((stack) => [clonePromptDocument(current), ...stack].slice(0, 50));
          setRedoStack([]);
        }

        return nextDocument;
      });
      setJsonText(JSON.stringify(nextDocument, null, 2));
    },
    []
  );

  const refreshHistory = useCallback(async () => {
    setHistory(await getHistory());
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
            task?.preparedImage?.transport === "data_url"
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
        setError(null);
        setPendingConsent(null);
        setActiveDocument(nextTask.document, { pushUndo: true });

        if (!savedTaskIds.current.has(nextTask.id)) {
          savedTaskIds.current.add(nextTask.id);
          void addHistoryItem({
            document: nextTask.document,
            sourcePageUrl: nextTask.source?.sourcePageUrl,
            sourceTitle: nextTask.source?.sourceTitle,
            thumbnail:
              nextTask.preparedImage?.transport === "data_url"
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
    setJsonText(JSON.stringify(document, null, 2));
  }, []);

  useEffect(() => {
    void sendRuntimeMessage<TaskState | null>({ type: "panel:get-state" }).then(
      (state) => {
        if (state) {
          handleTaskState(state);
        }
      }
    );
    void refreshHistory();
  }, [handleTaskState, refreshHistory]);

  useEffect(() => {
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

      if (message.type === "background:placeholder") {
        setError({
          code: "unknown_error",
          title: "功能占位",
          message: message.message,
          canRetry: false
        });
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
        const parsed = JSON.parse(nextText) as PromptDocument;
        setActiveDocument(parsed, { pushUndo: true });
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
    [setActiveDocument]
  );

  const handleInstructionSubmit = useCallback(
    async (instruction: string) => {
      const localEdit = applyFieldAssignment(document, instruction);

      if (localEdit) {
        setActiveDocument(localEdit, { pushUndo: true });
        setError(null);
        return;
      }

      try {
        await sendRuntimeMessage<TaskState>({
          type: "panel:edit-prompt",
          document,
          instruction
        });
      } catch (caught) {
        setError(toUserFacingError(caught));
      }
    },
    [document, setActiveDocument]
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
            onAnalyze={(image) =>
              sendRuntimeMessage({ type: "panel:analyze-image", image })
            }
          />

          <PromptPreview
            document={document}
            onSave={saveCurrentToHistory}
            isSaving={isSavingHistory}
          />

          <JsonEditor
            value={jsonText}
            onChange={handleJsonChange}
            onUndo={undo}
            onRedo={redo}
            canUndo={undoStack.length > 0}
            canRedo={redoStack.length > 0}
          />

          <InstructionInput
            disabled={isBusy}
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

      {viewMode === "settings" && <SettingsPanel />}
    </div>
  );
}

async function sendRuntimeMessage<T>(message: unknown): Promise<T> {
  const response = (await chrome.runtime.sendMessage(message)) as RuntimeResponse<T>;

  if (!response?.ok) {
    throw response?.error ?? new Error("Runtime message failed.");
  }

  return response.data as T;
}

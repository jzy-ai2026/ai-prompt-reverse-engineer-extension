import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Copy,
  ImagePlus,
  ImageIcon,
  Loader2,
  RefreshCw,
  Trash2,
  WandSparkles
} from "lucide-react";
import { toUserFacingError, type UserFacingError } from "../../lib/errors";
import type {
  AssistantAspectRatio,
  AssistantPromptInput,
  AssistantPromptMode,
  AssistantPromptResult,
  AssistantReferenceRole,
  AssistantResolution
} from "../../lib/openaiClient";
import type { AssistantHistoryItem } from "../../lib/storage";
import { Tooltip } from "./Tooltip";
import {
  collectImageFiles,
  createImportedImagesFromFiles,
  getClipboardImageFiles,
  getDataTransferImageFiles,
  hasImageFiles,
  MAX_REFERENCE_IMAGE_FILES
} from "./imageFiles";

interface CapturedImage {
  url: string;
  sourcePageUrl?: string;
  sourceTitle?: string;
  tabId?: number;
}

interface AssistantGenerateResponse {
  result: AssistantPromptResult;
  history: AssistantHistoryItem[];
}

interface NanoBananaAssistantProps {
  mixImages: CapturedImage[];
  disabled: boolean;
  onGenerate: (input: AssistantPromptInput) => Promise<AssistantGenerateResponse>;
  onGetHistory: () => Promise<AssistantHistoryItem[]>;
  onRemoveHistory: (id: string) => Promise<AssistantHistoryItem[]>;
  onClearHistory: () => Promise<void>;
  onAddReferenceImages: (images: CapturedImage[]) => void | Promise<unknown>;
  onRemoveReferenceImage: (url: string) => void | Promise<unknown>;
  onClearReferenceImages: () => void | Promise<unknown>;
}

const ASSISTANT_MODES: Array<{
  value: AssistantPromptMode;
  label: string;
  hint: string;
}> = [
  {
    value: "auto",
    label: "自动判断",
    hint: "根据是否有参考图和你的描述，自动选择文生图、图文生成或编辑图片。"
  },
  {
    value: "text-to-image",
    label: "文生图",
    hint: "只根据文字想法生成 Nano Banana Pro 可直接使用的英文提示词。"
  },
  {
    value: "image-and-text",
    label: "图文生成",
    hint: "把参考图作为身份、风格、构图或材质依据，再结合文字生成新图提示词。"
  },
  {
    value: "editing",
    label: "编辑图片",
    hint: "面向改图任务，会强调保留或替换哪些视觉元素。"
  }
];

const REFERENCE_ROLES: Array<{
  value: AssistantReferenceRole;
  label: string;
}> = [
  { value: "identity", label: "身份参考" },
  { value: "style", label: "风格参考" },
  { value: "composition", label: "构图参考" },
  { value: "scene", label: "场景参考" },
  { value: "product", label: "产品参考" },
  { value: "text", label: "文字参考" },
  { value: "material", label: "材质参考" }
];

const ROLE_HINTS: Record<AssistantReferenceRole, string> = {
  identity: "锁定人物、角色或产品身份，避免被其它图混合替换。",
  style: "只提取画风、质感、调色和整体视觉语言。",
  composition: "参考镜头角度、版式、空间关系和构图节奏。",
  scene: "参考地点、环境、背景叙事和空间氛围。",
  product: "参考产品造型、结构、品牌文字和可识别特征。",
  text: "参考画面文字、排版、标题风格或字形要求。",
  material: "参考材质、表面处理、纹理和细节密度。"
};

const ASPECT_RATIOS: AssistantAspectRatio[] = [
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
];

const ASPECT_RATIO_LABELS: Record<AssistantAspectRatio, string> = {
  "1:1": "1:1 方图",
  "2:3": "2:3 竖版",
  "3:2": "3:2 横版",
  "3:4": "3:4 竖版",
  "4:3": "4:3 横版",
  "4:5": "4:5 竖版",
  "5:4": "5:4 横版",
  "9:16": "9:16 手机竖屏",
  "16:9": "16:9 宽屏",
  "21:9": "21:9 超宽屏"
};

const RESOLUTIONS: AssistantResolution[] = ["1K", "2K", "4K"];

const RESOLUTION_LABELS: Record<AssistantResolution, string> = {
  "1K": "1K 草图",
  "2K": "2K 推荐",
  "4K": "4K 高细节"
};

const RESOLUTION_HINTS: Record<AssistantResolution, string> = {
  "1K": "适合快速草图和低成本测试。",
  "2K": "适合默认出图，质量和速度比较均衡。",
  "4K": "适合最终海报、产品图和细节要求高的画面。"
};

export function NanoBananaAssistant({
  mixImages,
  disabled,
  onGenerate,
  onGetHistory,
  onRemoveHistory,
  onClearHistory,
  onAddReferenceImages,
  onRemoveReferenceImage,
  onClearReferenceImages
}: NanoBananaAssistantProps) {
  const referenceInputRef = useRef<HTMLInputElement | null>(null);
  const [mode, setMode] = useState<AssistantPromptMode>("auto");
  const [idea, setIdea] = useState("");
  const [aspectRatio, setAspectRatio] = useState<AssistantAspectRatio>("16:9");
  const [resolution, setResolution] = useState<AssistantResolution>("2K");
  const [identityLock, setIdentityLock] = useState(false);
  const [extraSpecs, setExtraSpecs] = useState("");
  const [referenceRoles, setReferenceRoles] = useState<
    Record<string, AssistantReferenceRole>
  >({});
  const [result, setResult] = useState<AssistantPromptResult | null>(null);
  const [history, setHistory] = useState<AssistantHistoryItem[]>([]);
  const [error, setError] = useState<UserFacingError | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isReadingReferences, setIsReadingReferences] = useState(false);
  const [isReferenceDropActive, setIsReferenceDropActive] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void onGetHistory().then(setHistory).catch(() => setHistory([]));
  }, [onGetHistory]);

  useEffect(() => {
    setReferenceRoles((current) => {
      const activeUrls = new Set(mixImages.map((image) => image.url));
      const next = Object.fromEntries(
        Object.entries(current).filter(([url]) => activeUrls.has(url))
      ) as Record<string, AssistantReferenceRole>;

      mixImages.forEach((image, index) => {
        if (!next[image.url]) {
          next[image.url] = getDefaultReferenceRole(index);
        }
      });

      return next;
    });
  }, [mixImages]);

  const remainingReferenceSlots = Math.max(
    0,
    MAX_REFERENCE_IMAGE_FILES - mixImages.length
  );
  const canAddReferenceImages =
    remainingReferenceSlots > 0 && !disabled && !isReadingReferences;

  const references = useMemo(
    () =>
      mixImages.map((image, index) => ({
        imageUrl: image.url,
        sourceImageUrl: image.url,
        sourcePageUrl: image.sourcePageUrl,
        sourceTitle: image.sourceTitle,
        label: `图片 ${index + 1}`,
        role: referenceRoles[image.url] ?? getDefaultReferenceRole(index)
      })),
    [mixImages, referenceRoles]
  );

  const canGenerate = idea.trim().length > 0 && !isLoading && !disabled;
  const currentMode = ASSISTANT_MODES.find((item) => item.value === mode);

  async function generatePrompt() {
    if (!idea.trim()) {
      setError({
        code: "missing_config",
        title: "缺少想法",
        message: "先写下你想让 Nano Banana Pro 生成或修改什么。",
        canRetry: false
      });
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await onGenerate({
        mode,
        idea,
        references,
        aspectRatio,
        resolution,
        identityLock,
        extraSpecs: extraSpecs.trim() || undefined
      });

      setResult(response.result);
      setHistory(response.history);
    } catch (caught) {
      setError(toUserFacingError(caught));
    } finally {
      setIsLoading(false);
    }
  }

  async function copyFinalPrompt() {
    if (!result?.finalPrompt) {
      return;
    }

    await navigator.clipboard.writeText(result.finalPrompt);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  async function refreshHistory() {
    setHistory(await onGetHistory());
  }

  async function removeHistory(id: string) {
    setHistory(await onRemoveHistory(id));
  }

  async function clearHistory() {
    await onClearHistory();
    setHistory([]);
  }

  async function addReferenceFiles(files: File[]) {
    if (!canAddReferenceImages) {
      return;
    }

    setIsReadingReferences(true);
    setError(null);

    try {
      const images = await createImportedImagesFromFiles(
        files,
        remainingReferenceSlots
      );

      if (images.length) {
        await onAddReferenceImages(images);
      }
    } catch (caught) {
      setError(toUserFacingError(caught));
    } finally {
      setIsReadingReferences(false);
    }
  }

  async function handleReferenceFileChange(
    event: React.ChangeEvent<HTMLInputElement>
  ) {
    const files = collectImageFiles(event.target.files ?? []);

    if (!files.length) {
      return;
    }

    try {
      await addReferenceFiles(files);
    } finally {
      event.target.value = "";
    }
  }

  function handleReferencePaste(event: React.ClipboardEvent<HTMLElement>) {
    const files = getClipboardImageFiles(event.clipboardData);

    if (!files.length) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    void addReferenceFiles(files);
  }

  function handleReferenceDragOver(event: React.DragEvent<HTMLElement>) {
    if (!hasImageFiles(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsReferenceDropActive(true);
  }

  function handleReferenceDragLeave(event: React.DragEvent<HTMLElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setIsReferenceDropActive(false);
    }
  }

  function handleReferenceDrop(event: React.DragEvent<HTMLElement>) {
    const files = getDataTransferImageFiles(event.dataTransfer);

    if (!files.length) {
      return;
    }

    event.preventDefault();
    setIsReferenceDropActive(false);
    void addReferenceFiles(files);
  }

  function restoreHistoryItem(item: AssistantHistoryItem) {
    setMode(item.input.mode);
    setIdea(item.input.idea);
    setAspectRatio(item.input.aspectRatio);
    setResolution(item.input.resolution);
    setIdentityLock(item.input.identityLock);
    setExtraSpecs(item.input.extraSpecs ?? "");
    setResult(item.result);
    setError(null);
    setReferenceRoles((current) => {
      const next = { ...current };

      item.input.references.forEach((reference, index) => {
        const image = mixImages[index];

        if (image) {
          next[image.url] = reference.role;
        }
      });

      return next;
    });
  }

  return (
    <main className="assistant-view">
      <section className="assistant-hero" aria-label="Nano Banana Pro 提示词助手">
        <div>
          <span className="hero-kicker">NANO BANANA PRO 提示词</span>
          <h2>提示词助手</h2>
        </div>
        <div className="hero-metrics">
          <Tooltip content="当前已加入多图参考队列的图片数量">
            <span>
              <ImageIcon size={14} />
              {mixImages.length ? `${mixImages.length} / 6 张参考图` : "纯文本"}
            </span>
          </Tooltip>
          <Tooltip content={`${RESOLUTION_HINTS[resolution]} 当前画幅为 ${aspectRatio}。`}>
            <span>
              {resolution} · {aspectRatio}
            </span>
          </Tooltip>
        </div>
      </section>

      <div className="assistant-grid">
        <section className="panel-section assistant-panel">
          <div className="section-header">
            <div>
              <h2>输入</h2>
              <p>把中文想法、参考图和限制条件整理成可直接复制的英文提示词</p>
            </div>
            <Tooltip content="根据你的想法、参考图角色、比例和分辨率生成最终英文提示词">
              <WandSparkles size={18} />
            </Tooltip>
          </div>

          <details className="assistant-guide">
            <summary>使用说明</summary>
            <div className="assistant-guide-list">
              <span>纯文字出图时，直接写画面目标、风格和要出现的文字。</span>
              <span>多图任务先在上方“多图参考”加入图片，再给每张图指定参考角色。</span>
              <span>需要保留人物或产品身份时，打开“身份锁定”，避免自动美化或改脸。</span>
            </div>
          </details>

          <div className="assistant-mode-grid" role="tablist" aria-label="任务类型">
            {ASSISTANT_MODES.map((item) => (
              <Tooltip content={item.hint} key={item.value}>
                <button
                  className={mode === item.value ? "active" : ""}
                  type="button"
                  role="tab"
                  aria-selected={mode === item.value}
                  onClick={() => setMode(item.value)}
                >
                  {item.label}
                </button>
              </Tooltip>
            ))}
          </div>
          <p className="assistant-field-hint">
            当前模式：{currentMode?.label ?? "自动判断"}。{currentMode?.hint}
          </p>

          <label className="field-label">
            <span>想法</span>
            <textarea
              value={idea}
              onChange={(event) => setIdea(event.target.value)}
              rows={6}
              placeholder="例如：生成一个国风武侠场景，角色站在雨夜古街中央，画面有电影海报质感。"
            />
          </label>

          <div className="assistant-control-grid">
            <label className="field-label">
              <span>画幅比例</span>
              <Tooltip content="决定最终画面的宽高关系，例如海报常用 4:5 或 9:16，横版封面常用 16:9。">
                <select
                  value={aspectRatio}
                  onChange={(event) =>
                    setAspectRatio(event.target.value as AssistantAspectRatio)
                  }
                >
                  {ASPECT_RATIOS.map((item) => (
                    <option value={item} key={item}>
                      {ASPECT_RATIO_LABELS[item]}
                    </option>
                  ))}
                </select>
              </Tooltip>
            </label>

            <label className="field-label">
              <span>分辨率</span>
              <Tooltip content={RESOLUTION_HINTS[resolution]}>
                <select
                  value={resolution}
                  onChange={(event) =>
                    setResolution(event.target.value as AssistantResolution)
                  }
                >
                  {RESOLUTIONS.map((item) => (
                    <option value={item} key={item}>
                      {RESOLUTION_LABELS[item]}
                    </option>
                  ))}
                </select>
              </Tooltip>
            </label>
          </div>

          <Tooltip content="用于人物、角色或产品一致性任务，会要求模型不要改年龄、脸型、比例和核心识别特征。">
            <label className="identity-lock-toggle">
              <input
                type="checkbox"
                checked={identityLock}
                onChange={(event) => setIdentityLock(event.target.checked)}
              />
              <span>身份锁定</span>
            </label>
          </Tooltip>

          <label className="field-label">
            <span>规格补充</span>
            <textarea
              value={extraSpecs}
              onChange={(event) => setExtraSpecs(event.target.value)}
              rows={3}
              placeholder="补充字体、品牌限制、画面文字、禁用元素、不能改变的角色特征等。"
            />
          </label>

          <div className="assistant-reference-list">
            <div className="assistant-reference-header">
              <div>
                <strong>参考图</strong>
                <span>{mixImages.length} / {MAX_REFERENCE_IMAGE_FILES}</span>
              </div>
              <div className="assistant-reference-actions">
                {mixImages.length > 0 && (
                  <Tooltip content="清空当前参考图队列">
                    <button
                      type="button"
                      aria-label="清空参考图"
                      onClick={onClearReferenceImages}
                      disabled={disabled || isReadingReferences}
                    >
                      <Trash2 size={14} />
                    </button>
                  </Tooltip>
                )}
              </div>
            </div>

            <div
              className={
                isReferenceDropActive
                  ? "assistant-reference-rail is-dragging"
                  : "assistant-reference-rail"
              }
              onDragOver={handleReferenceDragOver}
              onDragLeave={handleReferenceDragLeave}
              onDrop={handleReferenceDrop}
              onPaste={handleReferencePaste}
            >
              <button
                className="assistant-reference-add-tile"
                type="button"
                onClick={() => referenceInputRef.current?.click()}
                disabled={!canAddReferenceImages}
              >
                {isReadingReferences ? (
                  <Loader2 className="spin" size={15} />
                ) : (
                  <ImagePlus size={16} />
                )}
                <span>
                  {isReadingReferences
                    ? "读取中"
                    : remainingReferenceSlots
                      ? "拖入 / 粘贴 / 点击"
                      : "已满"}
                </span>
              </button>

              {mixImages.map((image, index) => {
                const role =
                  referenceRoles[image.url] ?? getDefaultReferenceRole(index);

                return (
                  <article
                    className="assistant-reference-tile"
                    key={image.url}
                    title={image.sourceTitle || `参考图 ${index + 1}`}
                  >
                    <img src={image.url} alt={`参考图 ${index + 1}`} />
                    <span className="assistant-reference-index">{index + 1}</span>
                    <Tooltip content={`移除图片 ${index + 1}`}>
                      <button
                        className="assistant-reference-remove"
                        type="button"
                        aria-label={`移除图片 ${index + 1}`}
                        onClick={() => onRemoveReferenceImage(image.url)}
                        disabled={disabled || isReadingReferences}
                      >
                        <Trash2 size={12} />
                      </button>
                    </Tooltip>
                    <Tooltip content={ROLE_HINTS[role]}>
                      <label className="assistant-reference-role-pill">
                        <span className="visually-hidden">
                          图片 {index + 1} 的参考角色
                        </span>
                        <select
                          value={role}
                          aria-label={`图片 ${index + 1} 的参考角色`}
                          onChange={(event) =>
                            setReferenceRoles((current) => ({
                              ...current,
                              [image.url]: event.target.value as AssistantReferenceRole
                            }))
                          }
                        >
                          {REFERENCE_ROLES.map((referenceRole) => (
                            <option
                              value={referenceRole.value}
                              key={referenceRole.value}
                            >
                              {referenceRole.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </Tooltip>
                  </article>
                );
              })}
            </div>

            <input
              ref={referenceInputRef}
              className="visually-hidden"
              type="file"
              accept="image/*"
              multiple
              onChange={handleReferenceFileChange}
            />
          </div>

          {error && (
            <section className="error-panel">
              <strong>{error.title}</strong>
              <p>{error.message}</p>
              {error.detail && <small>{error.detail}</small>}
            </section>
          )}

          <Tooltip content="生成会调用模型网关，输出最终英文提示词和中文检查项。">
            <button
              className="assistant-primary-action"
              type="button"
              onClick={generatePrompt}
              disabled={!canGenerate}
            >
              {isLoading ? <Loader2 className="spin" size={16} /> : <WandSparkles size={16} />}
              <span>{isLoading ? "生成中" : "生成提示词"}</span>
            </button>
          </Tooltip>
        </section>

        <section className="panel-section assistant-output">
          <div className="section-header">
            <div>
              <h2>结果</h2>
              <p>{result?.brief || "等待生成，最终提示词会显示在这里"}</p>
            </div>
            <Tooltip content="复制最终英文提示词">
              <button
                type="button"
                onClick={copyFinalPrompt}
                disabled={!result?.finalPrompt}
              >
                {copied ? <Check size={16} /> : <Copy size={16} />}
              </button>
            </Tooltip>
          </div>

          {result ? (
            <>
              <div className="assistant-final-prompt">{result.finalPrompt}</div>
              <AssistantResultList title="需要确认的问题" items={result.questions} />
              <AssistantResultList title="默认假设" items={result.assumptions} />
              <AssistantResultList
                title="负面约束"
                items={result.negativeConstraints}
              />
            </>
          ) : (
            <div className="empty-state">暂无结果</div>
          )}
        </section>
      </div>

      <section className="panel-section assistant-history-panel">
        <div className="section-header">
          <div>
            <h2>助手历史</h2>
            <p>最近 20 条</p>
          </div>
          <div className="button-row compact">
            <Tooltip content="刷新助手历史">
              <button type="button" onClick={refreshHistory}>
                <RefreshCw size={16} />
              </button>
            </Tooltip>
            <Tooltip content="清空助手历史">
              <button
                type="button"
                onClick={clearHistory}
                disabled={!history.length}
              >
                <Trash2 size={16} />
              </button>
            </Tooltip>
          </div>
        </div>

        {history.length ? (
          <div className="assistant-history-list">
            {history.map((item) => (
              <article className="assistant-history-item" key={item.id}>
                <Tooltip content="恢复这条助手记录">
                  <button type="button" onClick={() => restoreHistoryItem(item)}>
                    <strong>{item.summaryTitle}</strong>
                    <span>{item.summarySubtitle}</span>
                    <time>{formatDate(item.createdAt)}</time>
                  </button>
                </Tooltip>
                <Tooltip content="删除这条助手记录">
                  <button
                    className="icon-danger"
                    type="button"
                    onClick={() => removeHistory(item.id)}
                  >
                    <Trash2 size={15} />
                  </button>
                </Tooltip>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state">暂无助手历史</div>
        )}
      </section>
    </main>
  );
}

function AssistantResultList({
  title,
  items
}: {
  title: string;
  items: string[];
}) {
  if (!items.length) {
    return null;
  }

  return (
    <div className="assistant-output-block">
      <strong>{title}</strong>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function getDefaultReferenceRole(index: number): AssistantReferenceRole {
  return index === 0 ? "identity" : "style";
}

function formatDate(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

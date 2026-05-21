import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Copy,
  ImagePlus,
  ImageIcon,
  Loader2,
  RefreshCw,
  Send,
  Trash2,
  WandSparkles
} from "lucide-react";
import { toUserFacingError, type UserFacingError } from "../../lib/errors";
import type {
  AssistantEngine,
  AssistantAspectRatio,
  AssistantPromptInput,
  AssistantPromptMode,
  AssistantPromptResult,
  AssistantReferenceRole,
  AssistantRenderQuality,
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
  referenceId?: string;
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
  onSetReferenceImages: (images: CapturedImage[]) => void | Promise<unknown>;
  onClearReferenceImages: () => void | Promise<unknown>;
  onSendToPhotoshop: (
    input: AssistantPromptInput,
    result: AssistantPromptResult,
    targetStageId?: string
  ) => Promise<unknown>;
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
    hint: "只根据文字想法生成可直接复制到目标模型的英文提示词。"
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

const ASSISTANT_ENGINES: Array<{
  value: AssistantEngine;
  label: string;
  hint: string;
}> = [
  {
    value: "nano-banana-pro",
    label: "Nano Banana Pro",
    hint: "适合改图、图文生成和发送到 Photoshop 工作流。"
  },
  {
    value: "midjourney-v8.1",
    label: "Midjourney V8.1",
    hint: "按 V8.1 官方参数规则生成英文 MJ Prompt。"
  }
];

const RENDER_QUALITIES: Array<{
  value: AssistantRenderQuality;
  label: string;
  hint: string;
}> = [
  {
    value: "sd",
    label: "探索 SD",
    hint: "标准分辨率，速度更快，适合先探索构图。"
  },
  {
    value: "hd",
    label: "定稿 HD",
    hint: "V8.1 原生 2K，高细节，适合最终候选。"
  }
];

const PHOTOSHOP_TARGET_STAGES = [
  { value: "", label: "跟随 PS 当前阶段" },
  { value: "reference_search", label: "01 · 查找参考图" },
  { value: "sketch", label: "02 · 草图" },
  { value: "lineart", label: "03 · 线稿" },
  { value: "color_key", label: "04 · 配色" },
  { value: "refine", label: "05 · 细化" },
  { value: "asset_split", label: "06 · 单体拆分" },
  { value: "turnaround", label: "07 · 三视图" },
  { value: "ingame_preview", label: "08 · 游戏内效果图" },
  { value: "layer_split", label: "09 · 自动拆分层" }
] as const;

type PhotoshopTargetStageId =
  (typeof PHOTOSHOP_TARGET_STAGES)[number]["value"];

export function NanoBananaAssistant({
  mixImages,
  disabled,
  onGenerate,
  onGetHistory,
  onRemoveHistory,
  onClearHistory,
  onAddReferenceImages,
  onSetReferenceImages,
  onClearReferenceImages,
  onSendToPhotoshop
}: NanoBananaAssistantProps) {
  const referenceInputRef = useRef<HTMLInputElement | null>(null);
  const [engine, setEngine] = useState<AssistantEngine>("nano-banana-pro");
  const [mode, setMode] = useState<AssistantPromptMode>("auto");
  const [idea, setIdea] = useState("");
  const [aspectRatio, setAspectRatio] = useState<AssistantAspectRatio>("16:9");
  const [resolution, setResolution] = useState<AssistantResolution>("2K");
  const [renderQuality, setRenderQuality] = useState<AssistantRenderQuality>("hd");
  const [rawEnabled, setRawEnabled] = useState(true);
  const [stylize, setStylize] = useState(120);
  const [isStylizeDirty, setIsStylizeDirty] = useState(false);
  const [chaos, setChaos] = useState(0);
  const [weird, setWeird] = useState(0);
  const [seed, setSeed] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [personalizationCode, setPersonalizationCode] = useState("");
  const [identityLock, setIdentityLock] = useState(false);
  const [photoshopTargetStageId, setPhotoshopTargetStageId] =
    useState<PhotoshopTargetStageId>("");
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
  const [isSendingToPhotoshop, setIsSendingToPhotoshop] = useState(false);
  const [draggedReferenceIndex, setDraggedReferenceIndex] = useState<number | null>(
    null
  );
  const [dragOverReferenceIndex, setDragOverReferenceIndex] = useState<
    number | null
  >(null);
  const [copied, setCopied] = useState(false);
  const [sentToPhotoshop, setSentToPhotoshop] = useState(false);

  useEffect(() => {
    void onGetHistory().then(setHistory).catch(() => setHistory([]));
  }, [onGetHistory]);

  useEffect(() => {
    setReferenceRoles((current) => {
      const activeKeys = new Set(
        mixImages.map((image, index) => getReferenceRoleKey(image, index))
      );
      const next = Object.fromEntries(
        Object.entries(current).filter(([key]) => activeKeys.has(key))
      ) as Record<string, AssistantReferenceRole>;

      mixImages.forEach((image, index) => {
        const roleKey = getReferenceRoleKey(image, index);

        if (!next[roleKey]) {
          next[roleKey] = getDefaultReferenceRole(index);
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
      mixImages.map((image, index) => {
        const roleKey = getReferenceRoleKey(image, index);

        return {
          imageUrl: image.url,
          sourceImageUrl: image.url,
          sourcePageUrl: image.sourcePageUrl,
          sourceTitle: image.sourceTitle,
          label: `图片 ${index + 1}`,
          role: referenceRoles[roleKey] ?? getDefaultReferenceRole(index)
        };
      }),
    [mixImages, referenceRoles]
  );

  const canGenerate = idea.trim().length > 0 && !isLoading && !disabled;
  const isMidjourney = engine === "midjourney-v8.1";
  const currentEngine = ASSISTANT_ENGINES.find((item) => item.value === engine);
  const currentMode = ASSISTANT_MODES.find((item) => item.value === mode);
  const currentRenderQuality =
    RENDER_QUALITIES.find((item) => item.value === renderQuality) ??
    {
      value: "hd" as const,
      label: "定稿 HD",
      hint: "V8.1 原生 2K，高细节，适合最终候选。"
    };
  const activeQualityHint = isMidjourney
    ? currentRenderQuality.hint
    : RESOLUTION_HINTS[resolution];
  const photoshopTargetStage =
    PHOTOSHOP_TARGET_STAGES.find((stage) => stage.value === photoshopTargetStageId) ??
    PHOTOSHOP_TARGET_STAGES[0];
  const photoshopTransferHint = sentToPhotoshop
    ? "已发送，回到 PS 点击接收并填入"
    : result?.finalPrompt
      ? "选择阶段后发送到本机 Photoshop"
      : "生成提示词后可发送到 Photoshop";
  const photoshopSendLabel = isSendingToPhotoshop
    ? "发送中"
    : sentToPhotoshop ? "已发送" : "发送到 PS";

  useEffect(() => {
    if (!isMidjourney || isStylizeDirty) {
      return;
    }

    setStylize(getMidjourneyStylizePreset(aspectRatio, renderQuality));
  }, [aspectRatio, isMidjourney, isStylizeDirty, renderQuality]);

  async function generatePrompt() {
    if (!idea.trim()) {
      setError({
        code: "missing_config",
        title: "缺少想法",
        message: isMidjourney
          ? "先写下你想让 Midjourney V8.1 生成什么。"
          : "先写下你想让 Nano Banana Pro 生成或修改什么。",
        canRetry: false
      });
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await onGenerate({
        engine,
        mode,
        idea,
        references,
        aspectRatio,
        resolution,
        identityLock,
        extraSpecs: extraSpecs.trim() || undefined,
        rawEnabled: isMidjourney ? rawEnabled : undefined,
        renderQuality: isMidjourney ? renderQuality : undefined,
        stylize: isMidjourney ? stylize : undefined,
        chaos: isMidjourney ? chaos : undefined,
        weird: isMidjourney ? weird : undefined,
        seed: isMidjourney ? seed.trim() || undefined : undefined,
        negativePrompt: isMidjourney ? negativePrompt.trim() || undefined : undefined,
        personalizationCode: isMidjourney
          ? personalizationCode.trim() || undefined
          : undefined
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

  async function sendToPhotoshop() {
    if (!result?.finalPrompt) {
      return;
    }

    setIsSendingToPhotoshop(true);
    setError(null);

    try {
      await onSendToPhotoshop(createAssistantInput(), result, photoshopTargetStageId);
      setSentToPhotoshop(true);
      window.setTimeout(() => setSentToPhotoshop(false), 1800);
    } catch (caught) {
      setError(toUserFacingError(caught));
    } finally {
      setIsSendingToPhotoshop(false);
    }
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

  function createAssistantInput(): AssistantPromptInput {
    return {
      engine,
      mode,
      idea,
      references,
      aspectRatio,
      resolution,
      identityLock,
      extraSpecs: extraSpecs.trim() || undefined,
      rawEnabled: isMidjourney ? rawEnabled : undefined,
      renderQuality: isMidjourney ? renderQuality : undefined,
      stylize: isMidjourney ? stylize : undefined,
      chaos: isMidjourney ? chaos : undefined,
      weird: isMidjourney ? weird : undefined,
      seed: isMidjourney ? seed.trim() || undefined : undefined,
      negativePrompt: isMidjourney ? negativePrompt.trim() || undefined : undefined,
      personalizationCode: isMidjourney
        ? personalizationCode.trim() || undefined
        : undefined
    };
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

  async function updateReferenceImages(images: CapturedImage[]) {
    try {
      setError(null);
      await onSetReferenceImages(images.slice(0, MAX_REFERENCE_IMAGE_FILES));
    } catch (caught) {
      setError(toUserFacingError(caught));
    }
  }

  async function duplicateReferenceImage(index: number) {
    if (!canAddReferenceImages) {
      return;
    }

    const image = mixImages[index];

    if (!image) {
      return;
    }

    const roleKey = getReferenceRoleKey(image, index);
    const duplicate: CapturedImage = {
      ...image,
      referenceId: createReferenceId(),
      sourceTitle: image.sourceTitle ? `${image.sourceTitle} 复制` : "复制参考图"
    };
    const duplicateRoleKey = getReferenceRoleKey(duplicate, index + 1);
    const nextImages = [
      ...mixImages.slice(0, index + 1),
      duplicate,
      ...mixImages.slice(index + 1)
    ].slice(0, MAX_REFERENCE_IMAGE_FILES);

    setReferenceRoles((current) => ({
      ...current,
      [duplicateRoleKey]: current[roleKey] ?? getDefaultReferenceRole(index)
    }));

    await updateReferenceImages(nextImages);
  }

  async function removeReferenceImageAt(index: number) {
    if (disabled || isReadingReferences) {
      return;
    }

    await updateReferenceImages(
      mixImages.filter((_, imageIndex) => imageIndex !== index)
    );
  }

  async function moveReferenceImage(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex || disabled || isReadingReferences) {
      return;
    }

    const nextImages = moveArrayItem(mixImages, fromIndex, toIndex);

    if (nextImages === mixImages) {
      return;
    }

    await updateReferenceImages(nextImages);
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

  function handleReferenceTileDragStart(
    event: React.DragEvent<HTMLElement>,
    index: number
  ) {
    if (disabled || isReadingReferences || mixImages.length < 2) {
      event.preventDefault();
      return;
    }

    if (isInteractiveDragTarget(event.target)) {
      event.preventDefault();
      return;
    }

    setDraggedReferenceIndex(index);
    setDragOverReferenceIndex(index);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", `reference-image:${index}`);
  }

  function handleReferenceTileDragOver(
    event: React.DragEvent<HTMLElement>,
    index: number
  ) {
    if (draggedReferenceIndex === null || disabled || isReadingReferences) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    setDragOverReferenceIndex(index);
  }

  function handleReferenceTileDrop(
    event: React.DragEvent<HTMLElement>,
    index: number
  ) {
    if (draggedReferenceIndex === null) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const fromIndex = draggedReferenceIndex;
    setDraggedReferenceIndex(null);
    setDragOverReferenceIndex(null);
    void moveReferenceImage(fromIndex, index);
  }

  function handleReferenceTileDragEnd() {
    setDraggedReferenceIndex(null);
    setDragOverReferenceIndex(null);
  }

  function restoreHistoryItem(item: AssistantHistoryItem) {
    setEngine(item.input.engine);
    setMode(item.input.mode);
    setIdea(item.input.idea);
    setAspectRatio(item.input.aspectRatio);
    setResolution(item.input.resolution);
    setRenderQuality(item.input.renderQuality ?? "hd");
    setRawEnabled(item.input.rawEnabled ?? true);
    setStylize(item.input.stylize ?? 120);
    setIsStylizeDirty(
      item.input.engine === "midjourney-v8.1" && typeof item.input.stylize === "number"
    );
    setChaos(item.input.chaos ?? 0);
    setWeird(item.input.weird ?? 0);
    setSeed(item.input.seed ?? "");
    setNegativePrompt(item.input.negativePrompt ?? "");
    setPersonalizationCode(item.input.personalizationCode ?? "");
    setIdentityLock(item.input.identityLock);
    setExtraSpecs(item.input.extraSpecs ?? "");
    setResult(item.result);
    setError(null);
    setReferenceRoles((current) => {
      const next = { ...current };

      item.input.references.forEach((reference, index) => {
        const image = mixImages[index];

        if (image) {
          next[getReferenceRoleKey(image, index)] = reference.role;
        }
      });

      return next;
    });
  }

  return (
    <main className="assistant-view">
      <section className="assistant-hero" aria-label="双引擎提示词助手">
        <div>
          <span className="hero-kicker">
            {isMidjourney ? "MIDJOURNEY V8.1 提示词" : "NANO BANANA PRO 提示词"}
          </span>
          <h2>提示词助手</h2>
        </div>
        <div className="hero-metrics">
          <Tooltip content="当前已加入多图参考队列的图片数量">
            <span>
              <ImageIcon size={14} />
              {mixImages.length ? `${mixImages.length} / 6 张参考图` : "纯文本"}
            </span>
          </Tooltip>
          <Tooltip content={`${activeQualityHint} 当前画幅为 ${aspectRatio}。`}>
            <span>
              {isMidjourney ? renderQuality.toUpperCase() : resolution} · {aspectRatio}
            </span>
          </Tooltip>
        </div>
      </section>

      <div className="assistant-grid">
        <section className="panel-section assistant-panel">
          <div className="section-header">
            <div>
              <h2>输入</h2>
              <p>
                {isMidjourney
                  ? "把中文创意整理成 Midjourney V8.1 可直接复制的英文 Prompt"
                  : "把中文想法、参考图和限制条件整理成可直接复制的英文提示词"}
              </p>
            </div>
            <Tooltip content={currentEngine?.hint ?? "选择目标模型后生成英文提示词"}>
              <WandSparkles size={18} />
            </Tooltip>
          </div>

          <div className="assistant-engine-grid" role="tablist" aria-label="提示词引擎">
            {ASSISTANT_ENGINES.map((item) => (
              <Tooltip content={item.hint} key={item.value}>
                <button
                  className={engine === item.value ? "active" : ""}
                  type="button"
                  role="tab"
                  aria-selected={engine === item.value}
                  onClick={() => setEngine(item.value)}
                >
                  {item.label}
                </button>
              </Tooltip>
            ))}
          </div>
          <p className="assistant-field-hint">
            当前引擎：{currentEngine?.label ?? "Nano Banana Pro"}。{currentEngine?.hint}
          </p>

          <details className="assistant-guide">
            <summary>使用说明</summary>
            <div className="assistant-guide-list">
              {isMidjourney ? (
                <>
                  <span>V8.1 会输出英文完整画面句子，并把参数统一放到末尾。</span>
                  <span>本地参考图会用占位 URL，使用前需要上传到 MJ 或 Discord 替换。</span>
                  <span>V8.1 不支持 --cref、--oref、--q、--draft 或 :: 多重提示。</span>
                </>
              ) : (
                <>
                  <span>纯文字出图时，直接写画面目标、风格和要出现的文字。</span>
                  <span>多图任务先在上方“多图参考”加入图片，再给每张图指定参考角色。</span>
                  <span>需要保留人物或产品身份时，打开“身份锁定”，避免自动美化或改脸。</span>
                </>
              )}
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
              placeholder={
                isMidjourney
                  ? "例如：国风武侠竹林电影画面，两名侠客在夕阳雾气中飞身交手，写实电影剧照。"
                  : "例如：生成一个国风武侠场景，角色站在雨夜古街中央，画面有电影海报质感。"
              }
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

            {isMidjourney ? (
              <label className="field-label">
                <span>输出质量</span>
                <Tooltip content={currentRenderQuality.hint}>
                  <select
                    value={renderQuality}
                    onChange={(event) =>
                      setRenderQuality(event.target.value as AssistantRenderQuality)
                    }
                  >
                    {RENDER_QUALITIES.map((item) => (
                      <option value={item.value} key={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </Tooltip>
              </label>
            ) : (
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
            )}
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

          {isMidjourney && (
            <section className="assistant-mj-panel" aria-label="Midjourney V8.1 参数">
              <div className="assistant-mj-header">
                <strong>MJ V8.1 参数</strong>
                <span>自动输出 --v 8.1，非法旧参数会被清理</span>
              </div>

              <Tooltip content="写实摄影、电影剧照、3A 游戏、产品和建筑默认建议启用 Raw。">
                <label className="identity-lock-toggle assistant-mj-toggle">
                  <input
                    type="checkbox"
                    checked={rawEnabled}
                    onChange={(event) => setRawEnabled(event.target.checked)}
                  />
                  <span>Raw 模式</span>
                </label>
              </Tooltip>

              <div className="assistant-mj-grid">
                <label className="field-label">
                  <span>Stylize</span>
                  <input
                    type="number"
                    min={0}
                    max={1000}
                    step={10}
                    value={stylize}
                    onChange={(event) => {
                      setIsStylizeDirty(true);
                      setStylize(readNumericInput(event.target.value, 120));
                    }}
                  />
                </label>
                <label className="field-label">
                  <span>Chaos</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={chaos}
                    onChange={(event) => setChaos(readNumericInput(event.target.value, 0))}
                  />
                </label>
                <label className="field-label">
                  <span>Weird</span>
                  <input
                    type="number"
                    min={0}
                    max={3000}
                    step={10}
                    value={weird}
                    onChange={(event) => setWeird(readNumericInput(event.target.value, 0))}
                  />
                </label>
                <label className="field-label">
                  <span>Seed</span>
                  <input
                    value={seed}
                    inputMode="numeric"
                    onChange={(event) => setSeed(event.target.value)}
                    placeholder="可选，如 1234"
                  />
                </label>
              </div>

              <label className="field-label">
                <span>Personalization</span>
                <input
                  value={personalizationCode}
                  onChange={(event) => setPersonalizationCode(event.target.value)}
                  placeholder="可选，填写 --p 后面的 profile code"
                />
              </label>

              <label className="field-label">
                <span>Negative Prompt</span>
                <textarea
                  value={negativePrompt}
                  onChange={(event) => setNegativePrompt(event.target.value)}
                  rows={2}
                  placeholder="例如：text, logo, watermark, UI, modern buildings"
                />
              </label>
            </section>
          )}

          <label className="field-label">
            <span>规格补充</span>
            <textarea
              value={extraSpecs}
              onChange={(event) => setExtraSpecs(event.target.value)}
              rows={3}
              placeholder={
                isMidjourney
                  ? "补充镜头、光影、材质、画面文字；不要写 --q、--cref、--oref、:: 等 V8.1 不支持参数。"
                  : "补充字体、品牌限制、画面文字、禁用元素、不能改变的角色特征等。"
              }
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
                const roleKey = getReferenceRoleKey(image, index);
                const role =
                  referenceRoles[roleKey] ?? getDefaultReferenceRole(index);
                const isReordering = draggedReferenceIndex === index;
                const isDropTarget =
                  draggedReferenceIndex !== null &&
                  draggedReferenceIndex !== index &&
                  dragOverReferenceIndex === index;
                const tileClassName = [
                  "assistant-reference-tile",
                  isReordering ? "is-reordering" : "",
                  isDropTarget ? "is-drop-target" : ""
                ]
                  .filter(Boolean)
                  .join(" ");

                return (
                  <article
                    className={tileClassName}
                    draggable={!disabled && !isReadingReferences && mixImages.length > 1}
                    key={`${roleKey}:${index}`}
                    title={`${image.sourceTitle || `参考图 ${index + 1}`}，拖拽可排序`}
                    onDragStart={(event) =>
                      handleReferenceTileDragStart(event, index)
                    }
                    onDragOver={(event) => handleReferenceTileDragOver(event, index)}
                    onDrop={(event) => handleReferenceTileDrop(event, index)}
                    onDragEnd={handleReferenceTileDragEnd}
                  >
                    <img src={image.url} alt={`参考图 ${index + 1}`} />
                    <span className="assistant-reference-index">{index + 1}</span>
                    <div className="assistant-reference-tile-actions">
                      <Tooltip content={`复制图片 ${index + 1}`}>
                        <button
                          className="assistant-reference-copy"
                          type="button"
                          aria-label={`复制图片 ${index + 1}`}
                          onClick={() => void duplicateReferenceImage(index)}
                          disabled={!canAddReferenceImages}
                        >
                          <Copy size={11} />
                        </button>
                      </Tooltip>
                      <Tooltip content={`移除图片 ${index + 1}`}>
                        <button
                          className="assistant-reference-remove"
                          type="button"
                          aria-label={`移除图片 ${index + 1}`}
                          onClick={() => void removeReferenceImageAt(index)}
                          disabled={disabled || isReadingReferences}
                        >
                          <Trash2 size={12} />
                        </button>
                      </Tooltip>
                    </div>
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
                              [roleKey]: event.target.value as AssistantReferenceRole
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

          {error && error.code !== "photoshop_bridge_unavailable" && (
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
              <span>
                {isLoading
                  ? "生成中"
                  : isMidjourney
                    ? "生成 MJ Prompt"
                    : "生成提示词"}
              </span>
            </button>
          </Tooltip>
        </section>

        <section className="panel-section assistant-output">
          <div
            className={
              sentToPhotoshop
                ? "assistant-transfer-bar is-sent"
                : "assistant-transfer-bar"
            }
          >
            <div className="assistant-transfer-status">
              <span className="assistant-transfer-mark" aria-hidden="true">
                {sentToPhotoshop ? <Check size={15} /> : <Send size={15} />}
              </span>
              <div>
                <strong>发送到 Photoshop</strong>
                <span>{photoshopTransferHint}</span>
              </div>
            </div>
            <div className="assistant-transfer-controls">
              <label className="assistant-photoshop-target">
                <span>目标阶段</span>
                <Tooltip content="选择后发送给 Photoshop 插件，PS 接收并填入时会切到对应阶段；保持默认则填入 PS 当前阶段。">
                  <select
                    value={photoshopTargetStageId}
                    onChange={(event) =>
                      setPhotoshopTargetStageId(
                        event.target.value as PhotoshopTargetStageId
                      )
                    }
                  >
                    {PHOTOSHOP_TARGET_STAGES.map((stage) => (
                      <option value={stage.value} key={stage.value || "current"}>
                        {stage.label}
                      </option>
                    ))}
                  </select>
                </Tooltip>
              </label>
              <Tooltip content={`发送到本机 Photoshop 场景原画助手：${photoshopTargetStage.label}`}>
                <button
                  className="assistant-send-button"
                  type="button"
                  onClick={sendToPhotoshop}
                  disabled={!result?.finalPrompt || isSendingToPhotoshop}
                >
                  {isSendingToPhotoshop ? (
                    <Loader2 className="spin" size={15} />
                  ) : sentToPhotoshop ? (
                    <Check size={15} />
                  ) : (
                    <Send size={15} />
                  )}
                  <span>{photoshopSendLabel}</span>
                </button>
              </Tooltip>
            </div>
          </div>

          {error?.code === "photoshop_bridge_unavailable" && (
            <section className="error-panel assistant-transfer-error">
              <strong>{error.title}</strong>
              <p>{error.message}</p>
              {error.detail && <small>{error.detail}</small>}
            </section>
          )}

          <div className="section-header assistant-output-head">
            <div>
              <h2>最终英文提示词</h2>
              <p>{result?.brief || "等待生成，英文提示词和中文核对会显示在这里"}</p>
            </div>
            <div className="button-row compact">
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
          </div>

          {result ? (
            <>
              <div className="assistant-final-prompt">{result.finalPrompt}</div>
              <AssistantChineseCheckPanel check={result.chineseCheck} />
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

function AssistantChineseCheckPanel({
  check
}: {
  check: AssistantPromptResult["chineseCheck"];
}) {
  const hasCheck =
    Boolean(check?.backTranslation) ||
    Boolean(check?.checklist.length) ||
    Boolean(check?.possibleIssues.length);

  if (!hasCheck) {
    return (
      <details className="assistant-output-block assistant-output-detail assistant-chinese-check">
        <summary>
          <strong>中文核对</strong>
          <span>暂无</span>
        </summary>
        <p className="assistant-check-empty">旧记录暂无中文核对。</p>
      </details>
    );
  }

  return (
    <details className="assistant-output-block assistant-output-detail assistant-chinese-check">
      <summary>
        <strong>中文核对</strong>
        <span>{check?.checklist.length || 0} 项</span>
      </summary>
      {check?.backTranslation && (
        <p className="assistant-check-translation">{check.backTranslation}</p>
      )}
      <AssistantCheckList title="核对清单" items={check?.checklist ?? []} />
      <AssistantCheckList title="可能需要确认" items={check?.possibleIssues ?? []} />
    </details>
  );
}

function AssistantCheckList({
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
    <div className="assistant-check-group">
      <span>{title}</span>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
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
  const shouldCollapse = title === "默认假设" || title === "负面约束";

  if (shouldCollapse) {
    return (
      <details className="assistant-output-block assistant-output-detail">
        <summary>
          <strong>{title}</strong>
          <span>{items.length} 项</span>
        </summary>
        <ul>
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </details>
    );
  }

  return (
    <div className="assistant-output-block assistant-output-list">
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

function getReferenceRoleKey(image: CapturedImage, index: number): string {
  return image.referenceId ?? image.url ?? `reference-${index}`;
}

function createReferenceId(): string {
  return `reference-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function moveArrayItem<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= items.length ||
    toIndex >= items.length
  ) {
    return items;
  }

  const next = [...items];
  const [item] = next.splice(fromIndex, 1);

  if (!item) {
    return items;
  }

  next.splice(toIndex, 0, item);
  return next;
}

function isInteractiveDragTarget(target: EventTarget): boolean {
  return (
    target instanceof Element &&
    Boolean(target.closest("button, input, label, select, textarea"))
  );
}

function readNumericInput(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getMidjourneyStylizePreset(
  aspectRatio: AssistantAspectRatio,
  renderQuality: AssistantRenderQuality
): number {
  if (renderQuality === "sd") {
    return 150;
  }

  if (aspectRatio === "4:5") {
    return 80;
  }

  if (aspectRatio === "21:9" || aspectRatio === "3:4" || aspectRatio === "2:3") {
    return 150;
  }

  return 120;
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

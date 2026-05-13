import { Maximize2, SendHorizontal, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Tooltip } from "./Tooltip";

type EditMode = "auto" | "text" | "vision";
type ResolvedEditMode = "text" | "vision";

export interface InstructionImageReference {
  index: number;
  label: string;
  thumbnail?: string;
  sourceTitle?: string;
}

interface InstructionInputProps {
  disabled: boolean;
  mode: EditMode;
  hasVisualContext: boolean;
  imageReferences: InstructionImageReference[];
  onModeChange: (mode: EditMode) => void;
  onSubmit: (
    instruction: string,
    resolvedMode: ResolvedEditMode,
    referencedImageIndexes: number[]
  ) => void | Promise<void>;
}

interface QuickAction {
  id: string;
  label: string;
  hint: string;
  instruction: string;
  boundary: string;
}

const QUICK_ACTIONS: QuickAction[] = [
  {
    id: "replace-subject",
    label: "替换主体",
    hint: "只改主体、物品、材质，不自动改光影、镜头、构图和场景。",
    instruction: "替换主体或主体材质。",
    boundary: "只允许修改主体、物品、材质、服装、道具等主体相关字段。"
  },
  {
    id: "premium-texture",
    label: "高级质感",
    hint: "只提升材质、清晰度、细节密度和商业完成度。",
    instruction: "提升为克制高级的商业摄影质感。",
    boundary: "只允许修改质感、清晰度、细节密度、材质可信度、商业完成度。"
  },
  {
    id: "reset-scene",
    label: "重设场景",
    hint: "只改环境、地点和背景叙事，不替换主体身份。",
    instruction: "重设场景或背景环境。",
    boundary: "只允许修改环境、地点、背景叙事、空间氛围。"
  },
  {
    id: "preserve-style",
    label: "保留风格",
    hint: "锁定原有风格、光影、色彩、镜头和构图。",
    instruction: "保留原图风格。",
    boundary: "必须锁定原有风格、光影、色彩、镜头、构图和整体视觉语言。"
  }
];

const VISION_REFERENCE_KEYWORDS = [
  "参考原图",
  "按原图",
  "保持原图风格",
  "根据图片",
  "像原图一样",
  "@图片"
];

export function InstructionInput({
  disabled,
  mode,
  hasVisualContext,
  imageReferences,
  onModeChange,
  onSubmit
}: InstructionInputProps) {
  const [value, setValue] = useState("");
  const [selectedActionIds, setSelectedActionIds] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const expandedTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const referencedImageIndexes = getReferencedImageIndexes(
    value,
    imageReferences.length
  );
  const selectedActions = QUICK_ACTIONS.filter((action) =>
    selectedActionIds.includes(action.id)
  );
  const resolvedMode = resolveEditMode(
    value,
    mode,
    hasVisualContext,
    referencedImageIndexes.length > 0
  );
  const canSubmit =
    !disabled &&
    !isSubmitting &&
    (value.trim().length > 0 || selectedActions.length > 0);

  useEffect(() => {
    if (!isExpanded) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsExpanded(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.requestAnimationFrame(() => expandedTextareaRef.current?.focus());

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isExpanded]);

  async function submit() {
    if (!canSubmit) {
      return;
    }

    const instruction = buildStructuredInstruction(
      value,
      selectedActions,
      referencedImageIndexes
    );

    setIsSubmitting(true);

    try {
      await onSubmit(instruction, resolvedMode, referencedImageIndexes);
      setValue("");
      setSelectedActionIds([]);
      setIsExpanded(false);
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleTextareaKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      void submit();
    }
  }

  function toggleQuickAction(actionId: string) {
    setSelectedActionIds((current) =>
      current.includes(actionId)
        ? current.filter((id) => id !== actionId)
        : [...current, actionId]
    );
  }

  function insertImageReference(reference: InstructionImageReference) {
    const token = `@图片${reference.index}`;
    const textarea = isExpanded ? expandedTextareaRef.current : textareaRef.current;

    setValue((current) => {
      if (!textarea) {
        const trimmed = current.trimEnd();
        return trimmed ? `${trimmed} ${token} ` : `${token} `;
      }

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const prefix = current.slice(0, start);
      const suffix = current.slice(end);
      const needsLeadingSpace = prefix.length > 0 && !/\s$/.test(prefix);
      const needsTrailingSpace = suffix.length > 0 && !/^\s/.test(suffix);
      return `${prefix}${needsLeadingSpace ? " " : ""}${token}${
        needsTrailingSpace ? " " : " "
      }${suffix}`;
    });

    window.requestAnimationFrame(() => textarea?.focus());
  }

  const editor = (
    <>
      <div className="instruction-mode-row">
        <span className="mode-badge" data-mode={resolvedMode}>
          {resolvedMode === "vision" ? "视觉参考" : "文本编辑"}
        </span>
        <Tooltip content="自动模式会在出现 @图片 引用时切到视觉参考">
          <select
            value={mode}
            onChange={(event) => onModeChange(event.target.value as EditMode)}
            disabled={disabled || isSubmitting}
            aria-label="编辑模式"
          >
            <option value="auto">自动判断</option>
            <option value="text">固定文本编辑</option>
            <option value="vision" disabled={!hasVisualContext}>
              固定视觉参考
            </option>
          </select>
        </Tooltip>
      </div>

      <div className="quick-action-row" aria-label="常用修改意图">
        {QUICK_ACTIONS.map((action) => (
          <Tooltip content={action.hint} key={action.id}>
            <button
              className={
                selectedActionIds.includes(action.id)
                  ? "quick-action active"
                  : "quick-action"
              }
              type="button"
              aria-pressed={selectedActionIds.includes(action.id)}
              onClick={() => toggleQuickAction(action.id)}
              disabled={disabled || isSubmitting}
            >
              {action.label}
            </button>
          </Tooltip>
        ))}
      </div>

      {imageReferences.length > 0 && (
        <div className="image-reference-row" aria-label="可引用图片">
          <span>引用</span>
          {imageReferences.map((reference) => (
            <Tooltip
              content={`插入 @图片${reference.index}，只让该图片参与本次编辑`}
              key={reference.index}
            >
              <button
                className={
                  referencedImageIndexes.includes(reference.index)
                    ? "image-reference-token active"
                    : "image-reference-token"
                }
                type="button"
                onClick={() => insertImageReference(reference)}
                disabled={disabled || isSubmitting}
              >
                {reference.thumbnail && <img src={reference.thumbnail} alt="" />}
                <strong>{reference.label}</strong>
              </button>
            </Tooltip>
          ))}
        </div>
      )}
    </>
  );

  return (
    <>
      <section className="instruction-bar">
        <div className="instruction-input-wrap">
          {editor}
          <textarea
            ref={textareaRef}
            rows={2}
            value={value}
            disabled={disabled || isSubmitting}
            placeholder="例如：根据 @图片2 的风格，重新设计 @图片1 的主体与材质"
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={handleTextareaKeyDown}
          />
        </div>
        <div className="instruction-actions">
          <Tooltip content="打开大窗口编辑更长的修改指令">
            <button
              type="button"
              aria-label="扩展编辑窗口"
              disabled={disabled || isSubmitting}
              onClick={() => setIsExpanded(true)}
            >
              <Maximize2 size={17} />
            </button>
          </Tooltip>
          <Tooltip content="提交修改，快捷意图会作为边界约束一起发送">
            <button type="button" disabled={!canSubmit} onClick={submit}>
              <SendHorizontal size={18} />
            </button>
          </Tooltip>
        </div>
      </section>

      {isExpanded && (
        <div className="instruction-modal" role="dialog" aria-modal="true">
          <section className="instruction-modal-panel">
            <header className="instruction-modal-header">
              <div>
                <strong>文本编辑</strong>
                <span>组合快捷意图会作为编辑边界，不会随意改动未选中的视觉维度。</span>
              </div>
              <Tooltip content="关闭扩展编辑窗口">
                <button type="button" onClick={() => setIsExpanded(false)}>
                  <X size={18} />
                </button>
              </Tooltip>
            </header>

            <div className="instruction-modal-body">
              {editor}
              <textarea
                ref={expandedTextareaRef}
                value={value}
                disabled={disabled || isSubmitting}
                placeholder="写下具体修改要求，可用 @图片1、@图片2 锁定多图编辑中的特定图片。"
                onChange={(event) => setValue(event.target.value)}
                onKeyDown={handleTextareaKeyDown}
              />
            </div>

            <footer className="instruction-modal-footer">
              <button type="button" className="secondary" onClick={() => setIsExpanded(false)}>
                收起
              </button>
              <Tooltip content="Ctrl/Cmd + Enter 也可以提交">
                <button type="button" disabled={!canSubmit} onClick={submit}>
                  <SendHorizontal size={17} />
                  提交修改
                </button>
              </Tooltip>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}

function buildStructuredInstruction(
  value: string,
  selectedActions: QuickAction[],
  referencedImageIndexes: number[]
): string {
  const lines = [
    "【编辑任务】",
    value.trim() || "按所选快捷意图修改当前 PromptDocument。",
    "",
    "【快捷意图】",
    selectedActions.length
      ? selectedActions.map((action) => `- ${action.label}: ${action.instruction}`).join("\n")
      : "- 无",
    "",
    "【编辑边界】",
    selectedActions.length
      ? selectedActions.map((action) => `- ${action.boundary}`).join("\n")
      : "- 只修改用户明确点名的内容。",
    "- 未被快捷意图选中、未被用户文字明确点名的视觉维度必须保持不变。",
    "- 默认锁定主体、光影、构图、镜头、色彩、风格；只有用户明确要求或对应快捷意图允许时才可修改。",
    "- 不要为了补全画面而自动混合多张参考图的身份、场景、光影或风格。",
    referencedImageIndexes.length
      ? `- 本次 @ 引用只作用于这些图片：${referencedImageIndexes
          .map((index) => `@图片${index}`)
          .join("、")}；不要扩散到其他参考图。`
      : "- 如果没有 @ 引用，不要主动引入其他参考图内容。"
  ];

  return lines.join("\n");
}

function resolveEditMode(
  instruction: string,
  mode: EditMode,
  hasVisualContext: boolean,
  hasExplicitImageReference = false
): ResolvedEditMode {
  if (mode === "text" || !hasVisualContext) {
    return "text";
  }

  if (mode === "vision") {
    return "vision";
  }

  return hasExplicitImageReference ||
    VISION_REFERENCE_KEYWORDS.some((keyword) => instruction.includes(keyword))
    ? "vision"
    : "text";
}

function getReferencedImageIndexes(
  instruction: string,
  referenceCount: number
): number[] {
  const indexes = new Set<number>();
  const pattern = /@图片\s*(\d+)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(instruction)) !== null) {
    const index = Number(match[1]);

    if (Number.isInteger(index) && index >= 1 && index <= referenceCount) {
      indexes.add(index);
    }
  }

  return Array.from(indexes).sort((left, right) => left - right);
}

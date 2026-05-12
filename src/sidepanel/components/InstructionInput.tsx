import { SendHorizontal } from "lucide-react";
import { useRef, useState } from "react";

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

export function InstructionInput({
  disabled,
  mode,
  hasVisualContext,
  imageReferences,
  onModeChange,
  onSubmit
}: InstructionInputProps) {
  const [value, setValue] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  async function submit() {
    const instruction = value.trim();
    const referencedImageIndexes = getReferencedImageIndexes(
      instruction,
      imageReferences.length
    );
    const resolvedMode = resolveEditMode(
      instruction,
      mode,
      hasVisualContext,
      referencedImageIndexes.length > 0
    );

    if (!instruction || disabled || isSubmitting) {
      return;
    }

    setIsSubmitting(true);

    try {
      await onSubmit(instruction, resolvedMode, referencedImageIndexes);
      setValue("");
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      void submit();
    }
  }

  function applyQuickAction(prompt: string) {
    setValue((current) => {
      const trimmed = current.trim();
      return trimmed ? `${trimmed}；${prompt}` : prompt;
    });
  }

  function insertImageReference(reference: InstructionImageReference) {
    const token = `@图片${reference.index}`;
    const textarea = textareaRef.current;

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
      return `${prefix}${needsLeadingSpace ? " " : ""}${token}${needsTrailingSpace ? " " : " "}${suffix}`;
    });

    window.requestAnimationFrame(() => textareaRef.current?.focus());
  }

  const referencedImageIndexes = getReferencedImageIndexes(
    value,
    imageReferences.length
  );
  const resolvedMode = resolveEditMode(
    value,
    mode,
    hasVisualContext,
    referencedImageIndexes.length > 0
  );

  return (
    <section className="instruction-bar">
      <div className="instruction-input-wrap">
        <div className="instruction-mode-row">
          <span className="mode-badge" data-mode={resolvedMode}>
            {resolvedMode === "vision" ? "视觉参考" : "文本编辑"}
          </span>
          <select
            value={mode}
            onChange={(event) => onModeChange(event.target.value as EditMode)}
            disabled={disabled || isSubmitting}
            title="编辑模式"
          >
            <option value="auto">自动判断</option>
            <option value="text">固定文本编辑</option>
            <option value="vision" disabled={!hasVisualContext}>
              固定视觉参考
            </option>
          </select>
        </div>
        <div className="quick-action-row" aria-label="常用修改意图">
          {QUICK_ACTIONS.map((action) => (
            <button
              className="quick-action"
              type="button"
              key={action.label}
              onClick={() => applyQuickAction(action.prompt)}
              disabled={disabled || isSubmitting}
            >
              {action.label}
            </button>
          ))}
        </div>
        {imageReferences.length > 0 && (
          <div className="image-reference-row" aria-label="可引用图片">
            <span>引用</span>
            {imageReferences.map((reference) => (
              <button
                className={
                  referencedImageIndexes.includes(reference.index)
                    ? "image-reference-token active"
                    : "image-reference-token"
                }
                type="button"
                key={reference.index}
                title={`插入 @图片${reference.index}`}
                onClick={() => insertImageReference(reference)}
                disabled={disabled || isSubmitting}
              >
                {reference.thumbnail && <img src={reference.thumbnail} alt="" />}
                <strong>{reference.label}</strong>
              </button>
            ))}
          </div>
        )}
        <textarea
          ref={textareaRef}
          rows={2}
          value={value}
          disabled={disabled || isSubmitting}
          placeholder="例如：根据 @图片2 的风格，重新设计 @图片1 的主体与材质"
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={handleKeyDown}
        />
      </div>
      <button
        type="button"
        title="提交修改"
        disabled={disabled || isSubmitting || !value.trim()}
        onClick={submit}
      >
        <SendHorizontal size={18} />
      </button>
    </section>
  );
}

const VISION_REFERENCE_KEYWORDS = [
  "参考原图",
  "按原图",
  "保持原图风格",
  "根据图片",
  "像原图一样",
  "@图片"
];

const QUICK_ACTIONS = [
  { label: "替换主体", prompt: "把主体替换为：" },
  { label: "高级质感", prompt: "改成克制高级的商业摄影质感，保持主体结构不变" },
  { label: "重设场景", prompt: "把场景调整为：" },
  { label: "保留风格", prompt: "按原图保持风格，并合理优化 JSON" }
];

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

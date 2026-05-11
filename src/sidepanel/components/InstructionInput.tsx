import { SendHorizontal } from "lucide-react";
import { useState } from "react";

type EditMode = "auto" | "text" | "vision";
type ResolvedEditMode = "text" | "vision";

interface InstructionInputProps {
  disabled: boolean;
  mode: EditMode;
  hasVisualContext: boolean;
  onModeChange: (mode: EditMode) => void;
  onSubmit: (instruction: string, resolvedMode: ResolvedEditMode) => void | Promise<void>;
}

export function InstructionInput({
  disabled,
  mode,
  hasVisualContext,
  onModeChange,
  onSubmit
}: InstructionInputProps) {
  const [value, setValue] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit() {
    const instruction = value.trim();

    if (!instruction || disabled || isSubmitting) {
      return;
    }

    setIsSubmitting(true);

    try {
      await onSubmit(instruction, resolveEditMode(instruction, mode, hasVisualContext));
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

  const resolvedMode = resolveEditMode(value, mode, hasVisualContext);

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
        <textarea
          rows={2}
          value={value}
          disabled={disabled || isSubmitting}
          placeholder="例如：把牛奶商标改成蒙牛牛奶，草莓改成蓝莓；或“按原图保持风格并换成清晨厨房”"
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
  "像原图一样"
];

const QUICK_ACTIONS = [
  { label: "替换元素", prompt: "把指定元素替换为：" },
  { label: "换风格", prompt: "改成更高级的商业摄影风格，保持主体结构不变" },
  { label: "换场景", prompt: "换成新的场景：" },
  { label: "按原图", prompt: "按原图保持风格，并合理优化 JSON" }
];

function resolveEditMode(
  instruction: string,
  mode: EditMode,
  hasVisualContext: boolean
): ResolvedEditMode {
  if (mode === "text" || !hasVisualContext) {
    return "text";
  }

  if (mode === "vision") {
    return "vision";
  }

  return VISION_REFERENCE_KEYWORDS.some((keyword) => instruction.includes(keyword))
    ? "vision"
    : "text";
}

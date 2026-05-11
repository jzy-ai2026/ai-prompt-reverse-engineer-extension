import { SendHorizontal } from "lucide-react";
import { useState } from "react";

interface InstructionInputProps {
  disabled: boolean;
  onSubmit: (instruction: string) => void | Promise<void>;
}

export function InstructionInput({
  disabled,
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
      await onSubmit(instruction);
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

  return (
    <section className="instruction-bar">
      <textarea
        rows={2}
        value={value}
        disabled={disabled || isSubmitting}
        placeholder="输入修改指令，例如：style=赛博朋克，或“把色调改成暖色”"
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleKeyDown}
      />
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

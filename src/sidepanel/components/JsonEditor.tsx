import { Check, Copy, Redo2, Undo2 } from "lucide-react";
import { useState } from "react";

interface JsonEditorProps {
  value: string;
  onChange: (value: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export function JsonEditor({
  value,
  onChange,
  onUndo,
  onRedo,
  canUndo,
  canRedo
}: JsonEditorProps) {
  const [copied, setCopied] = useState(false);

  async function copyJson() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  return (
    <section className="panel-section json-editor">
      <div className="section-header">
        <div>
          <h2>结构化 JSON</h2>
          <p>只展示模型生成结果，可直接编辑，合法 JSON 会同步到 Prompt 预览</p>
        </div>
        <div className="button-row compact">
          <button type="button" title="撤销" onClick={onUndo} disabled={!canUndo}>
            <Undo2 size={16} />
          </button>
          <button type="button" title="重做" onClick={onRedo} disabled={!canRedo}>
            <Redo2 size={16} />
          </button>
          <button type="button" title="复制 JSON" onClick={copyJson}>
            {copied ? <Check size={16} /> : <Copy size={16} />}
          </button>
        </div>
      </div>

      <textarea
        spellCheck={false}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </section>
  );
}

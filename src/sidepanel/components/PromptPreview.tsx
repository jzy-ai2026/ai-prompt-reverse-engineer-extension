import { Check, Copy, Save } from "lucide-react";
import { useMemo, useState } from "react";
import {
  buildRawPromptText,
  getPromptFieldKeys,
  type PromptDocument
} from "../../lib/promptDocument";

interface PromptPreviewProps {
  document: PromptDocument;
  onSave: () => void | Promise<void>;
  isSaving: boolean;
}

export function PromptPreview({
  document,
  onSave,
  isSaving
}: PromptPreviewProps) {
  const [copied, setCopied] = useState(false);
  const promptText = useMemo(
    () => document.raw_prompt_text || buildRawPromptText(document),
    [document]
  );

  async function copyPrompt() {
    await navigator.clipboard.writeText(promptText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  return (
    <section className="panel-section prompt-preview">
      <div className="section-header">
        <div>
          <h2>Prompt 预览</h2>
          <p>{document.metadata.model_suggestion || "适用于主流图像/视频生成模型"}</p>
        </div>
        <div className="button-row compact">
          <button type="button" title="复制 Prompt" onClick={copyPrompt}>
            {copied ? <Check size={16} /> : <Copy size={16} />}
          </button>
          <button type="button" title="保存到历史" onClick={onSave} disabled={isSaving}>
            <Save size={16} />
          </button>
        </div>
      </div>

      <div className="prompt-text">{promptText || "等待分析结果"}</div>

      {document.negative_prompt && (
        <div className="negative-prompt">
          <strong>Negative</strong>
          <span>{document.negative_prompt}</span>
        </div>
      )}

      <div className="field-grid">
        {getPromptFieldKeys().map((key) => {
          const field = document.prompt[key];

          return (
            <div className="field-chip" key={key}>
              <span>{key}</span>
              <strong>{Math.round(field.confidence * 100)}%</strong>
            </div>
          );
        })}
      </div>
    </section>
  );
}

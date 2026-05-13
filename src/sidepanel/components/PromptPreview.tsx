import { Check, Copy, Save } from "lucide-react";
import { useMemo, useState } from "react";
import {
  createPromptPreviewText,
  getPromptFieldKeys,
  type PromptDocument
} from "../../lib/promptDocument";
import { Tooltip } from "./Tooltip";

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
  const isTemplateResult = document.template_output !== undefined;
  const promptText = useMemo(
    () => createPromptPreviewText(document),
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
          <Tooltip content="复制当前可直接使用的 Prompt">
            <button type="button" onClick={copyPrompt}>
              {copied ? <Check size={16} /> : <Copy size={16} />}
            </button>
          </Tooltip>
          <Tooltip content="保存当前结果到历史记录">
            <button type="button" onClick={onSave} disabled={isSaving}>
              <Save size={16} />
            </button>
          </Tooltip>
        </div>
      </div>

      <div className="prompt-text">{promptText || "等待分析结果"}</div>

      {document.negative_prompt && (
        <div className="negative-prompt">
          <strong>Negative</strong>
          <span>{document.negative_prompt}</span>
        </div>
      )}

      {!isTemplateResult && (
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
      )}
    </section>
  );
}

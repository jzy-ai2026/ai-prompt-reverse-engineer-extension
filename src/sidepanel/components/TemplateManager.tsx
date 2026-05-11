import { Copy, Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { PromptTemplate, PromptTemplateInputMode } from "../../lib/promptTemplates";
import {
  deleteCustomPromptTemplate,
  duplicatePromptTemplate,
  saveCustomPromptTemplate
} from "../../lib/storage";

interface TemplateManagerProps {
  templates: PromptTemplate[];
  selectedTemplateId: string;
  onTemplatesChanged: (templates: PromptTemplate[]) => void;
  onSelectedTemplateChange: (templateId: string) => void | Promise<void>;
}

const EMPTY_TEMPLATE: PromptTemplate = {
  id: "",
  name: "",
  description: "",
  systemPrompt: "",
  icon: "Sparkles",
  kind: "custom",
  inputMode: "single_image"
};

export function TemplateManager({
  templates,
  selectedTemplateId,
  onTemplatesChanged,
  onSelectedTemplateChange
}: TemplateManagerProps) {
  const [activeId, setActiveId] = useState(selectedTemplateId || templates[0]?.id || "");
  const activeTemplate = useMemo(
    () => templates.find((template) => template.id === activeId),
    [activeId, templates]
  );
  const [draft, setDraft] = useState<PromptTemplate>(activeTemplate ?? EMPTY_TEMPLATE);
  const isBuiltIn = draft.kind === "built_in";

  useEffect(() => {
    if (activeTemplate) {
      setDraft(activeTemplate);
    }
  }, [activeTemplate]);

  async function createTemplate() {
    const blank = {
      ...EMPTY_TEMPLATE,
      id: "",
      name: "自定义模板",
      description: "描述这个模板的用途",
      systemPrompt: "你是一位专业的 AI 提示词助手。请根据用户输入输出合法 JSON。"
    };
    setActiveId("");
    setDraft(blank);
  }

  async function saveDraft() {
    if (isBuiltIn) {
      return;
    }

    const nextTemplates = await saveCustomPromptTemplate(draft);
    onTemplatesChanged(nextTemplates);
    const saved =
      nextTemplates.find((template) => template.name === draft.name) ??
      nextTemplates[nextTemplates.length - 1];

    if (saved) {
      setActiveId(saved.id);
    }
  }

  async function duplicateActive() {
    if (!draft.id) {
      return;
    }

    const nextTemplates = await duplicatePromptTemplate(draft.id);
    onTemplatesChanged(nextTemplates);
    const newestCustom = nextTemplates.find(
      (template) => template.kind === "custom" && template.name === `${draft.name} 副本`
    );

    if (newestCustom) {
      setActiveId(newestCustom.id);
    }
  }

  async function deleteActive() {
    if (!draft.id || isBuiltIn) {
      return;
    }

    const nextTemplates = await deleteCustomPromptTemplate(draft.id);
    onTemplatesChanged(nextTemplates);
    setActiveId(nextTemplates[0]?.id ?? "");
  }

  return (
    <main className="templates-view">
      <div className="section-header">
        <div>
          <h2>模板库</h2>
          <p>内置模板不可删除，可复制后改成自定义模板。</p>
        </div>
        <button type="button" title="新增自定义模板" onClick={createTemplate}>
          <Plus size={16} />
        </button>
      </div>

      <section className="template-layout">
        <div className="template-list">
          {templates.map((template) => (
            <button
              className={template.id === activeId ? "template-item active" : "template-item"}
              type="button"
              key={template.id}
              onClick={() => setActiveId(template.id)}
            >
              <strong>{template.name}</strong>
              <span>{template.kind === "built_in" ? "内置" : "自定义"}</span>
            </button>
          ))}
        </div>

        <div className="template-editor">
          <div className="template-editor-actions">
            <button
              type="button"
              className={selectedTemplateId === draft.id ? "active" : ""}
              onClick={() => draft.id && onSelectedTemplateChange(draft.id)}
              disabled={!draft.id}
            >
              设为当前
            </button>
            <button type="button" title="复制为自定义" onClick={duplicateActive} disabled={!draft.id}>
              <Copy size={16} />
            </button>
            <button type="button" title="保存模板" onClick={saveDraft} disabled={isBuiltIn}>
              <Save size={16} />
            </button>
            <button
              className="icon-danger"
              type="button"
              title="删除自定义模板"
              onClick={deleteActive}
              disabled={isBuiltIn || !draft.id}
            >
              <Trash2 size={16} />
            </button>
          </div>

          <label className="field-label">
            <span>名称</span>
            <input
              value={draft.name}
              readOnly={isBuiltIn}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </label>

          <label className="field-label">
            <span>描述</span>
            <input
              value={draft.description}
              readOnly={isBuiltIn}
              onChange={(event) =>
                setDraft({ ...draft, description: event.target.value })
              }
            />
          </label>

          <div className="template-meta-grid">
            <label className="field-label">
              <span>Lucide 图标名</span>
              <input
                value={draft.icon}
                readOnly={isBuiltIn}
                onChange={(event) => setDraft({ ...draft, icon: event.target.value })}
              />
            </label>
            <label className="field-label">
              <span>输入类型</span>
              <select
                value={draft.inputMode}
                disabled={isBuiltIn}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    inputMode: event.target.value as PromptTemplateInputMode
                  })
                }
              >
                <option value="single_image">单图</option>
                <option value="multi_image">多图</option>
                <option value="text">文本</option>
              </select>
            </label>
          </div>

          <label className="field-label">
            <span>System Prompt</span>
            <textarea
              className="template-prompt-textarea"
              value={draft.systemPrompt}
              readOnly={isBuiltIn}
              onChange={(event) =>
                setDraft({ ...draft, systemPrompt: event.target.value })
              }
            />
          </label>
        </div>
      </section>
    </main>
  );
}

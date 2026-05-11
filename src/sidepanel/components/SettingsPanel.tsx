import { Check, RotateCcw, Save } from "lucide-react";
import { useEffect, useState } from "react";
import {
  clearPrivacyConsent,
  getSettings,
  saveSettings,
  type ExtensionSettings
} from "../../lib/storage";

export function SettingsPanel() {
  const [settings, setSettings] = useState<ExtensionSettings | null>(null);
  const [customModel, setCustomModel] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void getSettings().then((loadedSettings) => {
      setSettings(loadedSettings);
      setCustomModel(loadedSettings.model);
    });
  }, []);

  async function save() {
    if (!settings) {
      return;
    }

    setIsSaving(true);

    try {
      const nextSettings = await saveSettings({
        ...settings,
        model: customModel.trim() || settings.model
      });
      setSettings(nextSettings);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1400);
    } finally {
      setIsSaving(false);
    }
  }

  async function resetPrivacy() {
    await clearPrivacyConsent();
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1400);
  }

  if (!settings) {
    return <main className="settings-view empty-state">正在读取设置</main>;
  }

  return (
    <main className="settings-view">
      <div className="section-header">
        <div>
          <h2>设置</h2>
          <p>API Key 只保存在 chrome.storage.local</p>
        </div>
        <button type="button" title="保存设置" onClick={save} disabled={isSaving}>
          {saved ? <Check size={16} /> : <Save size={16} />}
        </button>
      </div>

      <label className="field-label">
        <span>API Base URL</span>
        <input
          value={settings.apiBaseUrl}
          placeholder="https://ai.leihuo.netease.com/api/v1"
          onChange={(event) =>
            setSettings({ ...settings, apiBaseUrl: event.target.value })
          }
        />
      </label>

      <label className="field-label">
        <span>API Key</span>
        <input
          type="password"
          value={settings.apiKey}
          placeholder="Bearer Token"
          onChange={(event) =>
            setSettings({ ...settings, apiKey: event.target.value })
          }
        />
      </label>

      <label className="field-label">
        <span>模型预设</span>
        <select
          value={settings.modelPresets.includes(customModel) ? customModel : ""}
          onChange={(event) => {
            const value = event.target.value;
            setCustomModel(value || customModel);
            setSettings({ ...settings, model: value || customModel });
          }}
        >
          <option value="">手动输入</option>
          {settings.modelPresets.map((model) => (
            <option value={model} key={model}>
              {model}
            </option>
          ))}
        </select>
      </label>

      <label className="field-label">
        <span>模型名称</span>
        <input
          value={customModel}
          placeholder="gpt-4o"
          onChange={(event) => {
            setCustomModel(event.target.value);
            setSettings({ ...settings, model: event.target.value });
          }}
        />
      </label>

      <section className="settings-note">
        <strong>开发模式</strong>
        <p>
          本地开发可通过 .env 提供 VITE_DEFAULT_API_BASE_URL、VITE_DEFAULT_MODEL
          和 VITE_DEFAULT_API_KEY。真实 .env 不会进入 git。
        </p>
      </section>

      <section className="settings-note">
        <strong>隐私授权</strong>
        <p>重置后，下次发送图片或图片 URL 前会再次询问。</p>
        <button className="secondary" type="button" onClick={resetPrivacy}>
          <RotateCcw size={16} />
          重置上传授权
        </button>
      </section>
    </main>
  );
}

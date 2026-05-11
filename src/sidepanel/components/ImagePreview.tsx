import { useEffect, useRef, useState } from "react";
import {
  ClipboardPaste,
  ImagePlus,
  Layers,
  RefreshCw,
  Trash2,
  Upload,
  X
} from "lucide-react";

interface CapturedImage {
  url: string;
  sourcePageUrl?: string;
  sourceTitle?: string;
  tabId?: number;
}

interface PreparedImagePayload {
  imageUrl: string;
  sourceImageUrl: string;
  transport: "remote_url" | "data_url";
  width?: number;
  height?: number;
  sizeBytes?: number;
  mimeType?: string;
  wasCompressed: boolean;
}

interface ImagePreviewProps {
  source?: CapturedImage;
  preparedImage?: PreparedImagePayload;
  mixImages: CapturedImage[];
  onAnalyze: (image: CapturedImage) => void | Promise<unknown>;
  onAnalyzeMix: () => void | Promise<unknown>;
  onRemoveMixImage: (url: string) => void | Promise<unknown>;
  onClearMixImages: () => void | Promise<unknown>;
}

export function ImagePreview({
  source,
  preparedImage,
  mixImages,
  onAnalyze,
  onAnalyzeMix,
  onRemoveMixImage,
  onClearMixImages
}: ImagePreviewProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isReadingFile, setIsReadingFile] = useState(false);
  const previewUrl = getPreviewUrl(source, preparedImage);

  useEffect(() => {
    function handlePaste(event: ClipboardEvent) {
      const file = getClipboardImageFile(event.clipboardData);

      if (!file || isReadingFile) {
        return;
      }

      event.preventDefault();
      void analyzeImageFile(file, file.name || "剪贴板截图");
    }

    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [isReadingFile, onAnalyze]);

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    try {
      await analyzeImageFile(file, file.name);
    } finally {
      event.target.value = "";
    }
  }

  async function analyzeImageFile(file: File, sourceTitle: string) {
    setIsReadingFile(true);

    try {
      const dataUrl = await readFileAsDataUrl(file);
      await onAnalyze({
        url: dataUrl,
        sourceTitle
      });
    } finally {
      setIsReadingFile(false);
    }
  }

  return (
    <section className="panel-section image-preview">
      <div className="section-header">
        <div>
          <h2>参考图片</h2>
          {source?.sourceTitle && <p>{source.sourceTitle}</p>}
        </div>
        <div className="button-row compact">
          {source && (
            <button
              type="button"
              title="重新分析"
              onClick={() => onAnalyze(source)}
            >
              <RefreshCw size={16} />
            </button>
          )}
          <button
            type="button"
            title="上传图片"
            onClick={() => fileInputRef.current?.click()}
            disabled={isReadingFile}
          >
            <Upload size={16} />
          </button>
        </div>
      </div>

      <div className="image-frame">
        {previewUrl ? (
          <img src={previewUrl} alt="当前参考图" />
        ) : (
          <button
            className="empty-image empty-image-button"
            type="button"
            title="上传图片"
            onClick={() => fileInputRef.current?.click()}
            disabled={isReadingFile}
          >
            <ImagePlus size={28} />
            <span>上传图片或粘贴截图</span>
          </button>
        )}
      </div>

      <div className="paste-hint">
        <ClipboardPaste size={14} />
        <span>截图复制后，点击侧栏按 Ctrl+V 直接上传分析</span>
      </div>

      {preparedImage && (
        <div className="image-meta">
          <span>{preparedImage.transport === "remote_url" ? "URL" : "Base64"}</span>
          {preparedImage.width && preparedImage.height && (
            <span>
              {preparedImage.width} x {preparedImage.height}
            </span>
          )}
          {preparedImage.sizeBytes && (
            <span>{formatBytes(preparedImage.sizeBytes)}</span>
          )}
        </div>
      )}

      <div className="mix-tray">
        <div className="mix-tray-header">
          <div>
            <strong>混搭队列</strong>
            <span>{mixImages.length ? `${mixImages.length} / 6 张参考图` : "右键图片可添加"}</span>
          </div>
          <div className="button-row compact">
            {mixImages.length > 0 && (
              <button type="button" title="清空混搭队列" onClick={onClearMixImages}>
                <Trash2 size={16} />
              </button>
            )}
            <button
              type="button"
              title="混搭反推"
              onClick={onAnalyzeMix}
              disabled={mixImages.length < 2}
            >
              <Layers size={16} />
            </button>
          </div>
        </div>

        {mixImages.length > 0 && (
          <div className="mix-image-grid">
            {mixImages.map((image, index) => (
              <div className="mix-image" key={image.url}>
                <img src={image.url} alt={`混搭参考图 ${index + 1}`} />
                <button
                  type="button"
                  title="移除"
                  onClick={() => onRemoveMixImage(image.url)}
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <input
        ref={fileInputRef}
        className="visually-hidden"
        type="file"
        accept="image/*"
        onChange={handleFileChange}
      />
    </section>
  );
}

function getClipboardImageFile(data: DataTransfer | null): File | null {
  if (!data) {
    return null;
  }

  for (const item of Array.from(data.items)) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      return item.getAsFile();
    }
  }

  for (const file of Array.from(data.files)) {
    if (file.type.startsWith("image/")) {
      return file;
    }
  }

  return null;
}

function getPreviewUrl(
  source?: CapturedImage,
  preparedImage?: PreparedImagePayload
): string | undefined {
  if (preparedImage?.transport === "data_url") {
    return preparedImage.imageUrl;
  }

  return source?.url;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Unable to read image file."));
      }
    };

    reader.onerror = () => reject(reader.error ?? new Error("File read failed."));
    reader.readAsDataURL(file);
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

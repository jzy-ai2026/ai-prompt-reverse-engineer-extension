import { useRef, useState } from "react";
import { ImagePlus, RefreshCw, Upload } from "lucide-react";

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
  onAnalyze: (image: CapturedImage) => void | Promise<unknown>;
}

export function ImagePreview({
  source,
  preparedImage,
  onAnalyze
}: ImagePreviewProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isReadingFile, setIsReadingFile] = useState(false);
  const previewUrl = getPreviewUrl(source, preparedImage);

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    setIsReadingFile(true);

    try {
      const dataUrl = await readFileAsDataUrl(file);
      await onAnalyze({
        url: dataUrl,
        sourceTitle: file.name
      });
    } finally {
      setIsReadingFile(false);
      event.target.value = "";
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
          <div className="empty-image">
            <ImagePlus size={28} />
          </div>
        )}
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

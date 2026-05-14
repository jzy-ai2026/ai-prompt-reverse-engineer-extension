import { useEffect, useRef, useState } from "react";
import {
  ClipboardPaste,
  FolderOpen,
  ImagePlus,
  Images,
  Layers,
  ListChecks,
  Loader2,
  RefreshCw,
  Trash2,
  Upload,
  X
} from "lucide-react";
import { Tooltip } from "./Tooltip";
import {
  collectImageFiles,
  createImportedImagesFromFiles,
  getClipboardImageFiles,
  getDataTransferImageFiles,
  hasImageFiles
} from "./imageFiles";

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
  isLoading?: boolean;
  progressPercent?: number;
  progressLabel?: string;
  progressDetail?: string;
  onAnalyze: (image: CapturedImage) => void | Promise<unknown>;
  onAnalyzeMulti: (mode: "style_common" | "batch") => void | Promise<unknown>;
  onAddMixImages: (images: CapturedImage[]) => void | Promise<unknown>;
  onRemoveMixImage: (url: string) => void | Promise<unknown>;
  onClearMixImages: () => void | Promise<unknown>;
}

type DropZone = "single" | "mix" | null;

const MAX_MIX_IMAGE_FILES = 6;
const DIRECTORY_INPUT_ATTRIBUTES = {
  directory: "",
  webkitdirectory: ""
};

export function ImagePreview({
  source,
  preparedImage,
  mixImages,
  isLoading = false,
  progressPercent,
  progressLabel,
  progressDetail,
  onAnalyze,
  onAnalyzeMulti,
  onAddMixImages,
  onRemoveMixImage,
  onClearMixImages
}: ImagePreviewProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mixFileInputRef = useRef<HTMLInputElement | null>(null);
  const mixFolderInputRef = useRef<HTMLInputElement | null>(null);
  const [isReadingFile, setIsReadingFile] = useState(false);
  const [isReadingMixFiles, setIsReadingMixFiles] = useState(false);
  const [dropZone, setDropZone] = useState<DropZone>(null);
  const previewUrl = getPreviewUrl(source, preparedImage);
  const isReading = isReadingFile || isReadingMixFiles;

  useEffect(() => {
    function handlePaste(event: ClipboardEvent) {
      const files = getClipboardImageFiles(event.clipboardData);

      if (!files.length || isReading) {
        return;
      }

      event.preventDefault();
      const target = event.target instanceof Element ? event.target : null;
      const isMixPaste = Boolean(target?.closest('[data-drop-zone="mix"]'));

      if (isMixPaste || files.length > 1) {
        void addImageFilesToMix(files);
        return;
      }

      void analyzeImageFile(files[0]!, files[0]?.name || "剪贴板截图");
    }

    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [isReading, onAnalyze]);

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

  function handleSinglePaste(event: React.ClipboardEvent<HTMLElement>) {
    const files = getClipboardImageFiles(event.clipboardData);

    if (!files.length || isReading) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    void analyzeImageFile(files[0]!, files[0]?.name || "剪贴板截图");
  }

  function handleMixPaste(event: React.ClipboardEvent<HTMLElement>) {
    const files = getClipboardImageFiles(event.clipboardData);

    if (!files.length || isReading) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    void addImageFilesToMix(files);
  }

  function handleDragOver(
    event: React.DragEvent<HTMLElement>,
    nextDropZone: Exclude<DropZone, null>
  ) {
    if (!hasImageFiles(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDropZone(nextDropZone);
  }

  function handleDragLeave(event: React.DragEvent<HTMLElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setDropZone(null);
    }
  }

  function handleSingleDrop(event: React.DragEvent<HTMLElement>) {
    const files = getDataTransferImageFiles(event.dataTransfer);

    if (!files.length) {
      return;
    }

    event.preventDefault();
    setDropZone(null);

    if (isReading) {
      return;
    }

    void analyzeImageFile(files[0]!, files[0]?.name || "拖拽图片");
  }

  function handleMixDrop(event: React.DragEvent<HTMLElement>) {
    const files = getDataTransferImageFiles(event.dataTransfer);

    if (!files.length) {
      return;
    }

    event.preventDefault();
    setDropZone(null);

    if (isReading) {
      return;
    }

    void addImageFilesToMix(files);
  }

  async function handleMixFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const files = collectImageFiles(event.target.files ?? []);

    if (!files.length) {
      return;
    }

    try {
      await addImageFilesToMix(files);
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

  async function addImageFilesToMix(files: File[]) {
    setIsReadingMixFiles(true);

    try {
      const images = await createImportedImagesFromFiles(files, MAX_MIX_IMAGE_FILES);
      await onAddMixImages(images);
    } finally {
      setIsReadingMixFiles(false);
    }
  }

  return (
    <section className="panel-section image-preview" data-has-preview={Boolean(previewUrl)}>
      <div className="section-header">
        <div>
          <h2>参考图</h2>
          {source?.sourceTitle && <p>{source.sourceTitle}</p>}
        </div>
        <div className="button-row compact">
          {source && (
            <Tooltip content="重新分析当前参考图">
              <button type="button" onClick={() => onAnalyze(source)}>
                <RefreshCw size={16} />
              </button>
            </Tooltip>
          )}
          <Tooltip content="上传一张图片并立即反推提示词">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isReading}
            >
              <Upload size={16} />
            </button>
          </Tooltip>
        </div>
      </div>

      <div
        className={dropZone === "single" ? "image-frame is-dragging" : "image-frame"}
        data-drop-zone="single"
        tabIndex={0}
        onDragOver={(event) => handleDragOver(event, "single")}
        onDragLeave={handleDragLeave}
        onDrop={handleSingleDrop}
        onPaste={handleSinglePaste}
      >
        {previewUrl ? (
          <img src={previewUrl} alt="当前参考图" />
        ) : (
          <button
            className="empty-image empty-image-button"
            type="button"
            title="上传图片"
            onClick={() => fileInputRef.current?.click()}
            disabled={isReading}
          >
            <ImagePlus size={28} />
            <strong>素材槽</strong>
            <span>拖入图片 / 粘贴截图</span>
          </button>
        )}
        {isLoading && (
          <div className="image-loading-overlay">
            <div className="image-loading-card">
              <Loader2 className="spin" size={22} />
              <strong>{progressLabel || "正在反推"}</strong>
              <span>{progressDetail || "正在处理图片并调用模型"}</span>
              <div className="image-loading-progress">
                <div style={{ width: `${normalizeProgress(progressPercent)}%` }} />
              </div>
              <b>{normalizeProgress(progressPercent)}%</b>
            </div>
          </div>
        )}
      </div>

      <div className="paste-hint">
        <ClipboardPaste size={14} />
        <span>导入后立即分析</span>
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

      <div
        className={dropZone === "mix" ? "mix-tray is-dragging" : "mix-tray"}
        data-drop-zone="mix"
        tabIndex={0}
        onDragOver={(event) => handleDragOver(event, "mix")}
        onDragLeave={handleDragLeave}
        onDrop={handleMixDrop}
        onPaste={handleMixPaste}
      >
        <div className="mix-tray-header">
          <div>
            <strong>多图参考</strong>
            <span>
              {mixImages.length
                ? `${mixImages.length} / 6 张参考图，2 张以上可开始`
                : "拖拽、粘贴或选择 2-6 张图，可同风格分析或逐张批量反推"}
            </span>
          </div>
          <div className="button-row compact mix-actions">
            <Tooltip content="一次选择多张图片加入参考队列">
              <button
                className="mix-add-action"
                type="button"
                onClick={() => mixFileInputRef.current?.click()}
                disabled={isReading}
              >
                <Images size={16} />
                <span>多选</span>
              </button>
            </Tooltip>
            <Tooltip content="按文件名顺序导入文件夹内的图片">
              <button
                className="mix-folder-action"
                type="button"
                onClick={() => mixFolderInputRef.current?.click()}
                disabled={isReading}
              >
                <FolderOpen size={16} />
                <span>文件夹</span>
              </button>
            </Tooltip>
            {mixImages.length > 0 && (
              <Tooltip content="清空当前多图参考队列">
                <button type="button" onClick={onClearMixImages}>
                  <Trash2 size={16} />
                </button>
              </Tooltip>
            )}
            <Tooltip content="提取多张图共享的视觉风格，不混合主体和场景">
              <button
                className="mix-primary-action"
                type="button"
                onClick={() => onAnalyzeMulti("style_common")}
                disabled={mixImages.length < 2 || isReading}
              >
                <Layers size={16} />
                <span>同风格</span>
              </button>
            </Tooltip>
            <Tooltip content="逐张反推并分别保存到历史记录">
              <button
                className="mix-batch-action"
                type="button"
                onClick={() => onAnalyzeMulti("batch")}
                disabled={mixImages.length < 2 || isReading}
              >
                <ListChecks size={16} />
                <span>批量</span>
              </button>
            </Tooltip>
          </div>
        </div>

        {mixImages.length > 0 && (
          <div className="mix-image-grid">
            {mixImages.map((image, index) => (
              <div className="mix-image" key={image.url}>
                <img src={image.url} alt={`多图参考图 ${index + 1}`} />
                <span className="mix-image-index">{index + 1}</span>
                <span className="mix-image-label">@图片{index + 1}</span>
                <Tooltip content={`移除图片 ${index + 1}`}>
                  <button type="button" onClick={() => onRemoveMixImage(image.url)}>
                    <X size={14} />
                  </button>
                </Tooltip>
              </div>
            ))}
          </div>
        )}

        {mixImages.length === 0 && (
          <div className="mix-drop-empty">
            <Images size={18} />
            <span>把多张图片拖到这里，或点击添加</span>
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
      <input
        ref={mixFileInputRef}
        className="visually-hidden"
        type="file"
        accept="image/*"
        multiple
        onChange={handleMixFileChange}
      />
      <input
        ref={mixFolderInputRef}
        className="visually-hidden"
        type="file"
        multiple
        {...DIRECTORY_INPUT_ATTRIBUTES}
        onChange={handleMixFileChange}
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

function normalizeProgress(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 8;
  }

  return Math.max(0, Math.min(100, Math.round(value)));
}

import { useEffect, useRef, useState } from "react";
import {
  ClipboardPaste,
  FolderOpen,
  ImagePlus,
  Images,
  Layers,
  ListChecks,
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
  onAnalyzeMulti: (mode: "style_common" | "batch") => void | Promise<unknown>;
  onAddMixImages: (images: CapturedImage[]) => void | Promise<unknown>;
  onRemoveMixImage: (url: string) => void | Promise<unknown>;
  onClearMixImages: () => void | Promise<unknown>;
}

type DropZone = "single" | "mix" | null;

const MAX_MIX_IMAGE_FILES = 6;
const IMAGE_FILE_EXTENSION_PATTERN = /\.(avif|bmp|gif|jpe?g|png|webp)$/i;
const DIRECTORY_INPUT_ATTRIBUTES = {
  directory: "",
  webkitdirectory: ""
};

export function ImagePreview({
  source,
  preparedImage,
  mixImages,
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
      const images = await Promise.all(
        files.slice(0, MAX_MIX_IMAGE_FILES).map(async (file) => ({
          url: await readFileAsDataUrl(file),
          sourceTitle: file.webkitRelativePath || file.name || "本地多图"
        }))
      );
      await onAddMixImages(images);
    } finally {
      setIsReadingMixFiles(false);
    }
  }

  return (
    <section className="panel-section image-preview">
      <div className="section-header">
        <div>
          <h2>参考图</h2>
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
            disabled={isReading}
          >
            <Upload size={16} />
          </button>
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
            <span>上传图片或粘贴截图</span>
          </button>
        )}
      </div>

      <div className="paste-hint">
        <ClipboardPaste size={14} />
        <span>单图支持拖拽、选择文件或粘贴截图，导入后立即分析</span>
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
            <button
              className="mix-add-action"
              type="button"
              title="多选图片"
              onClick={() => mixFileInputRef.current?.click()}
              disabled={isReading}
            >
              <Images size={16} />
              <span>多选</span>
            </button>
            <button
              className="mix-folder-action"
              type="button"
              title="导入文件夹"
              onClick={() => mixFolderInputRef.current?.click()}
              disabled={isReading}
            >
              <FolderOpen size={16} />
              <span>文件夹</span>
            </button>
            {mixImages.length > 0 && (
              <button type="button" title="清空多图参考" onClick={onClearMixImages}>
                <Trash2 size={16} />
              </button>
            )}
            <button
              className="mix-primary-action"
              type="button"
              title="同风格分析"
              onClick={() => onAnalyzeMulti("style_common")}
              disabled={mixImages.length < 2 || isReading}
            >
              <Layers size={16} />
              <span>同风格</span>
            </button>
            <button
              className="mix-batch-action"
              type="button"
              title="批量分析"
              onClick={() => onAnalyzeMulti("batch")}
              disabled={mixImages.length < 2 || isReading}
            >
              <ListChecks size={16} />
              <span>批量</span>
            </button>
          </div>
        </div>

        {mixImages.length > 0 && (
          <div className="mix-image-grid">
            {mixImages.map((image, index) => (
              <div className="mix-image" key={image.url}>
                <img src={image.url} alt={`多图参考图 ${index + 1}`} />
                <span className="mix-image-index">{index + 1}</span>
                <span className="mix-image-label">@图片{index + 1}</span>
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

function collectImageFiles(files: FileList | File[]): File[] {
  return Array.from(files)
    .filter(isImageFile)
    .sort((left, right) =>
      getFileSortKey(left).localeCompare(getFileSortKey(right), undefined, {
        numeric: true,
        sensitivity: "base"
      })
    );
}

function isImageFile(file: File): boolean {
  return file.type.startsWith("image/") || IMAGE_FILE_EXTENSION_PATTERN.test(file.name);
}

function getFileSortKey(file: File): string {
  return file.webkitRelativePath || file.name;
}

function getClipboardImageFiles(data: DataTransfer | null): File[] {
  if (!data) {
    return [];
  }

  const files: File[] = [];

  for (const item of Array.from(data.items)) {
    if (
      item.kind === "file" &&
      (item.type.startsWith("image/") || !item.type)
    ) {
      const file = item.getAsFile();

      if (file && isImageFile(file)) {
        files.push(file);
      }
    }
  }

  if (files.length) {
    return files;
  }

  for (const file of Array.from(data.files)) {
    if (isImageFile(file)) {
      files.push(file);
    }
  }

  return files;
}

function getDataTransferImageFiles(data: DataTransfer): File[] {
  return collectImageFiles(data.files);
}

function hasImageFiles(data: DataTransfer): boolean {
  const items = Array.from(data.items);

  if (items.some((item) => item.kind === "file" && item.type.startsWith("image/"))) {
    return true;
  }

  return Array.from(data.files).some(isImageFile);
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

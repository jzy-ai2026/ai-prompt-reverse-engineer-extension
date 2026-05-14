import {
  compressImageBlob,
  FAST_VISION_IMAGE_LONG_EDGE,
  FAST_VISION_JPEG_QUALITY,
  FAST_VISION_MAX_DATA_URL_BYTES
} from "../../lib/imagePipeline";

export interface ImportedImageFile {
  url: string;
  sourceTitle: string;
}

export const MAX_REFERENCE_IMAGE_FILES = 6;

const IMAGE_FILE_EXTENSION_PATTERN = /\.(avif|bmp|gif|jpe?g|png|webp)$/i;

export function collectImageFiles(files: FileList | File[]): File[] {
  return Array.from(files)
    .filter(isImageFile)
    .sort((left, right) =>
      getFileSortKey(left).localeCompare(getFileSortKey(right), undefined, {
        numeric: true,
        sensitivity: "base"
      })
    );
}

export function getClipboardImageFiles(data: DataTransfer | null): File[] {
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

export function getDataTransferImageFiles(data: DataTransfer): File[] {
  return collectImageFiles(data.files);
}

export function hasImageFiles(data: DataTransfer): boolean {
  const items = Array.from(data.items);

  if (items.some((item) => item.kind === "file" && item.type.startsWith("image/"))) {
    return true;
  }

  return Array.from(data.files).some(isImageFile);
}

export async function createImportedImagesFromFiles(
  files: File[],
  limit = MAX_REFERENCE_IMAGE_FILES
): Promise<ImportedImageFile[]> {
  return Promise.all(
    files.slice(0, limit).map(async (file) => ({
      url: await readReferenceFileAsDataUrl(file),
      sourceTitle: file.webkitRelativePath || file.name || "本地参考图"
    }))
  );
}

async function readReferenceFileAsDataUrl(file: File): Promise<string> {
  const compressed = await compressImageBlob(file, {
    maxLongEdge: FAST_VISION_IMAGE_LONG_EDGE,
    maxBytes: FAST_VISION_MAX_DATA_URL_BYTES,
    initialQuality: FAST_VISION_JPEG_QUALITY
  });

  return compressed.dataUrl;
}

export function readFileAsDataUrl(file: File): Promise<string> {
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

function isImageFile(file: File): boolean {
  return file.type.startsWith("image/") || IMAGE_FILE_EXTENSION_PATTERN.test(file.name);
}

function getFileSortKey(file: File): string {
  return file.webkitRelativePath || file.name;
}

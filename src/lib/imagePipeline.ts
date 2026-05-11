import { createAppError } from "./errors";

export const MAX_IMAGE_LONG_EDGE = 1536;
export const DEFAULT_JPEG_QUALITY = 0.8;
export const MAX_DATA_URL_BYTES = 1_000_000;
const MIN_JPEG_QUALITY = 0.45;
const QUALITY_STEP = 0.08;

export interface ImageSourceInput {
  url: string;
  sourcePageUrl?: string;
  sourceTitle?: string;
}

export interface PreparedImagePayload {
  imageUrl: string;
  sourceImageUrl: string;
  transport: "remote_url" | "data_url";
  width?: number;
  height?: number;
  sizeBytes?: number;
  mimeType?: string;
  wasCompressed: boolean;
}

export interface ImagePipelineProgress {
  phase: "checking_url" | "fetching_image" | "decoding_image" | "compressing_image";
  message?: string;
}

export interface PrepareImageOptions {
  signal?: AbortSignal;
  onProgress?: (event: ImagePipelineProgress) => void;
}

interface EncodedImage {
  dataUrl: string;
  sizeBytes: number;
  width: number;
  height: number;
  mimeType: string;
}

export function canUseRemoteImageUrl(url: string): boolean {
  if (!isHttpUrl(url)) {
    return false;
  }

  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();

    return (
      !isLocalHostname(hostname) &&
      !isPrivateIpv4(hostname) &&
      !hostname.endsWith(".local")
    );
  } catch {
    return false;
  }
}

export async function prepareImageForVision(
  source: ImageSourceInput,
  options: PrepareImageOptions = {}
): Promise<PreparedImagePayload> {
  const imageUrl = source.url.trim();

  if (!imageUrl) {
    throw createAppError("image_not_found", "No image URL was captured.");
  }

  options.onProgress?.({
    phase: "checking_url",
    message: "Checking whether the original image URL can be sent directly."
  });

  if (canUseRemoteImageUrl(imageUrl)) {
    return {
      imageUrl,
      sourceImageUrl: imageUrl,
      transport: "remote_url",
      wasCompressed: false
    };
  }

  return fetchAndCompressImage(imageUrl, options);
}

export async function fetchAndCompressImage(
  imageUrl: string,
  options: PrepareImageOptions = {}
): Promise<PreparedImagePayload> {
  options.onProgress?.({
    phase: "fetching_image",
    message: "Fetching image for local compression."
  });

  const blob = await fetchImageBlob(imageUrl, options.signal);
  const encoded = await compressImageBlob(blob, options);

  return {
    imageUrl: encoded.dataUrl,
    sourceImageUrl: imageUrl,
    transport: "data_url",
    width: encoded.width,
    height: encoded.height,
    sizeBytes: encoded.sizeBytes,
    mimeType: encoded.mimeType,
    wasCompressed: true
  };
}

export async function compressImageBlob(
  blob: Blob,
  options: PrepareImageOptions = {}
): Promise<EncodedImage> {
  if (!blob.type.startsWith("image/")) {
    throw createAppError(
      "image_fetch_failed",
      "Fetched resource is not an image.",
      { mimeType: blob.type }
    );
  }

  options.onProgress?.({
    phase: "decoding_image",
    message: "Decoding image before compression."
  });

  let bitmap: ImageBitmap;

  try {
    bitmap = await createImageBitmap(blob);
  } catch (error) {
    throw createAppError(
      "image_decode_failed",
      "Unable to decode this image. The image may be protected or unsupported.",
      { cause: String(error) }
    );
  }

  try {
    options.signal?.throwIfAborted();

    const { width, height } = getScaledDimensions(bitmap.width, bitmap.height);
    const canvas = createCanvas(width, height);
    const context = canvas.getContext("2d");

    if (!context) {
      throw createAppError(
        "image_compression_failed",
        "Unable to create a canvas context for image compression."
      );
    }

    options.onProgress?.({
      phase: "compressing_image",
      message: "Compressing image for gateway request limits."
    });

    context.drawImage(bitmap, 0, 0, width, height);

    let quality = DEFAULT_JPEG_QUALITY;
    let best: EncodedImage | null = null;

    while (quality >= MIN_JPEG_QUALITY) {
      options.signal?.throwIfAborted();

      const dataUrl = await canvasToJpegDataUrl(canvas, quality);
      const sizeBytes = estimateDataUrlBytes(dataUrl);
      best = {
        dataUrl,
        sizeBytes,
        width,
        height,
        mimeType: "image/jpeg"
      };

      if (sizeBytes <= MAX_DATA_URL_BYTES) {
        return best;
      }

      quality -= QUALITY_STEP;
    }

    if (best && best.sizeBytes <= MAX_DATA_URL_BYTES * 1.15) {
      return best;
    }

    throw createAppError(
      "image_too_large",
      "Compressed image is still larger than 1MB.",
      {
        sizeBytes: best?.sizeBytes,
        maxBytes: MAX_DATA_URL_BYTES
      }
    );
  } finally {
    bitmap.close();
  }
}

async function fetchImageBlob(
  imageUrl: string,
  signal?: AbortSignal
): Promise<Blob> {
  if (imageUrl.startsWith("data:image/")) {
    return dataUrlToBlob(imageUrl);
  }

  try {
    const response = await fetch(imageUrl, {
      method: "GET",
      credentials: "include",
      signal
    });

    if (!response.ok) {
      throw createAppError(
        "image_fetch_failed",
        `Image fetch failed with status ${response.status}.`,
        { status: response.status }
      );
    }

    return response.blob();
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw createAppError("request_cancelled", "Image fetch was cancelled.");
    }

    if (isKnownAppErrorCode(error)) {
      throw error;
    }

    throw createAppError(
      "image_cors_blocked",
      "该图片受跨域限制，建议下载后拖拽上传或换一张公开图片。",
      { imageUrl, cause: String(error) }
    );
  }
}

function createCanvas(
  width: number,
  height: number
): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(width, height);
  }

  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  throw createAppError(
    "image_compression_failed",
    "No canvas implementation is available in this runtime."
  );
}

async function canvasToJpegDataUrl(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  quality: number
): Promise<string> {
  if ("convertToBlob" in canvas) {
    const blob = await canvas.convertToBlob({
      type: "image/jpeg",
      quality
    });

    return blobToDataUrl(blob);
  }

  return canvas.toDataURL("image/jpeg", quality);
}

function getScaledDimensions(width: number, height: number): {
  width: number;
  height: number;
} {
  const longEdge = Math.max(width, height);

  if (longEdge <= MAX_IMAGE_LONG_EDGE) {
    return { width, height };
  }

  const scale = MAX_IMAGE_LONG_EDGE / longEdge;

  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
}

function estimateDataUrlBytes(dataUrl: string): number {
  const base64 = dataUrl.split(",", 2)[1] ?? "";
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return `data:${blob.type || "image/jpeg"};base64,${btoa(binary)}`;
}

function dataUrlToBlob(dataUrl: string): Blob {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/i.exec(dataUrl);

  if (!match) {
    throw createAppError("image_decode_failed", "Invalid data URL image.");
  }

  const mimeType = match[1] || "application/octet-stream";
  const isBase64 = Boolean(match[2]);
  const payload = match[3] ?? "";
  const binary = isBase64 ? atob(payload) : decodeURIComponent(payload);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], { type: mimeType });
}

function isHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

function isLocalHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.startsWith("localhost.")
  );
}

function isPrivateIpv4(hostname: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);

  if (!match) {
    return false;
  }

  const octets = match.slice(1).map(Number);
  const first = octets[0] ?? 0;
  const second = octets[1] ?? 0;

  return (
    first === 10 ||
    first === 127 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function isKnownAppErrorCode(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
  );
}

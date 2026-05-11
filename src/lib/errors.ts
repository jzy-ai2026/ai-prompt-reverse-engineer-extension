export type AppErrorCode =
  | "missing_config"
  | "api_http_error"
  | "api_response_error"
  | "empty_model_response"
  | "model_json_parse_error"
  | "request_timeout"
  | "request_cancelled"
  | "image_not_found"
  | "image_fetch_failed"
  | "image_cors_blocked"
  | "image_decode_failed"
  | "image_compression_failed"
  | "image_too_large"
  | "privacy_denied"
  | "unknown_error";

export interface AppErrorDetails {
  status?: number;
  responseText?: string;
  rawText?: string;
  phase?: string;
  [key: string]: unknown;
}

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly details: AppErrorDetails;

  constructor(code: AppErrorCode, message: string, details: AppErrorDetails = {}) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.details = details;
  }
}

export interface UserFacingError {
  code: AppErrorCode;
  title: string;
  message: string;
  detail?: string;
  canRetry: boolean;
}

export function createAppError(
  code: AppErrorCode,
  message: string,
  details: AppErrorDetails = {}
): AppError {
  return new AppError(code, message, details);
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError || isSerializedAppError(error);
}

export function serializeError(error: unknown): AppErrorDetails & {
  code: AppErrorCode;
  message: string;
  name: string;
} {
  if (isAppError(error)) {
    return {
      name: "AppError",
      code: error.code,
      message: error.message,
      ...error.details
    };
  }

  if (error instanceof Error) {
    return {
      name: error.name,
      code: "unknown_error",
      message: error.message
    };
  }

  return {
    name: "UnknownError",
    code: "unknown_error",
    message: String(error)
  };
}

export function deserializeError(value: unknown): AppError {
  if (isSerializedAppError(value)) {
    const { code, message, ...details } = value;
    return createAppError(code, message, details);
  }

  return createAppError("unknown_error", "发生未知错误。", {
    original: value
  });
}

export function toUserFacingError(error: unknown): UserFacingError {
  const appError = isAppError(error)
    ? error
    : createAppError("unknown_error", getUnknownErrorMessage(error), {
        original: serializeError(error)
      });

  switch (appError.code) {
    case "missing_config":
      return {
        code: appError.code,
        title: "需要配置 API",
        message: "请先在设置中填写 API Base URL、API Key 和模型名称。",
        canRetry: false
      };

    case "api_http_error":
      return {
        code: appError.code,
        title: "API 请求失败",
        message: `网关返回 ${appError.details.status ?? "非 200"}，请检查 Key、模型或网关状态。`,
        detail: createShortDetail(appError.details.responseText),
        canRetry: true
      };

    case "api_response_error":
      return {
        code: appError.code,
        title: "API 响应异常",
        message: "网关返回的不是标准 JSON 响应。",
        detail: createShortDetail(appError.details.responseText),
        canRetry: true
      };

    case "empty_model_response":
      return {
        code: appError.code,
        title: "模型没有返回内容",
        message: "请重试，或更换模型后再次分析。",
        canRetry: true
      };

    case "model_json_parse_error":
      return {
        code: appError.code,
        title: "模型返回格式异常",
        message: "模型返回格式异常，请检查模型是否支持 JSON 模式。",
        detail: createShortDetail(appError.details.rawText),
        canRetry: true
      };

    case "request_timeout":
      return {
        code: appError.code,
        title: "请求超时",
        message: "请求超过 60 秒未完成。请重试，或换一张更小的图片。",
        canRetry: true
      };

    case "request_cancelled":
      return {
        code: appError.code,
        title: "请求已取消",
        message: "当前分析任务已停止。",
        canRetry: true
      };

    case "image_not_found":
      return {
        code: appError.code,
        title: "没有捕获到图片",
        message: "请在网页图片上右键，再选择反推提示词。",
        canRetry: false
      };

    case "image_fetch_failed":
      return {
        code: appError.code,
        title: "图片读取失败",
        message: "无法读取这张图片。请换一张公开图片，或稍后重试。",
        canRetry: true
      };

    case "image_cors_blocked":
      return {
        code: appError.code,
        title: "图片受跨域限制",
        message: "该图片受跨域限制，建议下载后拖拽上传或换一张公开图片。",
        canRetry: false
      };

    case "image_decode_failed":
      return {
        code: appError.code,
        title: "图片解码失败",
        message: "这张图片格式暂不支持，或图片内容已损坏。",
        canRetry: false
      };

    case "image_compression_failed":
      return {
        code: appError.code,
        title: "图片压缩失败",
        message: "无法在当前浏览器环境中压缩图片。请换一张公开图片 URL。",
        canRetry: false
      };

    case "image_too_large":
      return {
        code: appError.code,
        title: "图片体积过大",
        message: "压缩后仍超过 1MB。请换一张更小的图片。",
        canRetry: false
      };

    case "privacy_denied":
      return {
        code: appError.code,
        title: "未授权上传",
        message: "你取消了图片/URL 上传授权，因此没有发送请求。",
        canRetry: false
      };

    case "unknown_error":
    default:
      return {
        code: "unknown_error",
        title: "发生未知错误",
        message: appError.message || "请重试，或检查浏览器控制台日志。",
        canRetry: true
      };
  }
}

function isSerializedAppError(value: unknown): value is {
  code: AppErrorCode;
  message: string;
  [key: string]: unknown;
} {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return typeof record.code === "string" && typeof record.message === "string";
}

function getUnknownErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error || "发生未知错误。");
}

function createShortDetail(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.replace(/\s+/g, " ").trim();

  if (!normalized) {
    return undefined;
  }

  return normalized.length > 240
    ? `${normalized.slice(0, 240)}...`
    : normalized;
}

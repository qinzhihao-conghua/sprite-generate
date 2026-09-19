import path from "node:path";
import sharp from "sharp";
import { AppError } from "./errors.js";
import type { Anchor, AnchorType, SourceFormat, SpriteConfig } from "./types.js";

const ICON_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const FORBIDDEN_SVG = [
  /<\s*(?:script|foreignObject|iframe|object|embed|audio|video)\b/i,
  /<\s*!DOCTYPE\b/i,
  /<\s*!ENTITY\b/i,
  /\son[a-z]+\s*=/i,
  /javascript\s*:/i,
  /\s(?:href|xlink:href|src)\s*=\s*["'](?!#)/i,
  /url\s*\(\s*["']?(?!#)/i,
  /@import\b/i
];

/** 校验并规范化稳定的业务图标 ID。 */
export function validateIconId(value: unknown): string {
  const iconId = String(value ?? "").trim();
  if (!ICON_ID_PATTERN.test(iconId)) {
    throw new AppError(
      "iconId 必须以字母或数字开头，且只能包含字母、数字、短横线和下划线（最长 64 位）",
      400,
      "INVALID_ICON_ID"
    );
  }
  return iconId;
}

/** 校验雪碧图基础名称，并在未提供时使用默认名称。 */
export function validateSpriteName(value: unknown, fallback = "sprite"): string {
  const name = String(value ?? fallback).trim() || fallback;
  if (!/^[\p{L}\p{N}][\p{L}\p{N}_-]{0,63}$/u.test(name)) {
    throw new AppError(
      "雪碧图名称必须以文字或数字开头，且只能包含文字、数字、短横线和下划线（最长 64 位）",
      400,
      "INVALID_SPRITE_NAME"
    );
  }
  return name;
}

/** 解析单个图标的显示尺寸。 */
export function parseDisplaySize(value: unknown, fallback = 32): number {
  if (value === undefined || value === null || value === "") return fallback;
  const size = Number(value);
  if (!Number.isFinite(size) || size < 8 || size > 256) {
    throw new AppError("显示尺寸必须在 8～256 CSS 像素之间", 400, "INVALID_DISPLAY_SIZE");
  }
  return size;
}

/** 解析并限制图标在 64×64 单元格中的透明边距。 */
export function parsePadding(value: unknown, fallback = 6): number {
  if (value === undefined || value === null || value === "") return fallback;
  const padding = Number(value);
  if (!Number.isInteger(padding) || padding < 0 || padding > 24) {
    throw new AppError("边距必须是 0～24 之间的整数像素", 400, "INVALID_PADDING");
  }
  return padding;
}

/** 将预设或自定义锚点字段转换为统一的分数坐标。 */
export function parseAnchor(
  anchorTypeValue: unknown,
  anchorXValue: unknown,
  anchorYValue: unknown
): { anchorType: AnchorType; anchor: Anchor } {
  const anchorType = String(anchorTypeValue ?? "center") as AnchorType;
  const presets: Record<Exclude<AnchorType, "custom">, Anchor> = {
    center: [0.5, 0.5],
    bottom: [0.5, 1],
    "bottom-left": [0, 1]
  };

  if (anchorType !== "custom") {
    const anchor = presets[anchorType as keyof typeof presets];
    if (!anchor) throw new AppError("不支持的锚点类型", 400, "INVALID_ANCHOR");
    return { anchorType, anchor };
  }

  const x = Number(anchorXValue);
  const y = Number(anchorYValue);
  if (![x, y].every((item) => Number.isFinite(item) && item >= 0 && item <= 1)) {
    throw new AppError("自定义锚点必须是 0～1 之间的坐标", 400, "INVALID_ANCHOR");
  }
  return { anchorType, anchor: [x, y] };
}

/** 检查 SVG 文本并拒绝脚本、事件属性和外部资源引用。 */
function validateSvg(source: Buffer): Buffer {
  const text = source.toString("utf8");
  if (!/<svg\b/i.test(text) || text.includes("\u0000")) {
    throw new AppError("SVG 内容无效", 415, "INVALID_SVG");
  }
  if (FORBIDDEN_SVG.some((pattern) => pattern.test(text))) {
    throw new AppError("SVG 包含脚本、事件、外部资源或不安全元素", 415, "UNSAFE_SVG");
  }
  const elementCount = (text.match(/<[a-zA-Z][\w:.-]*(?:\s|\/?>)/g) ?? []).length;
  if (elementCount > 2_000) {
    throw new AppError("SVG 元素数量超过 2000 个", 413, "SVG_TOO_COMPLEX");
  }
  return Buffer.from(text.trim(), "utf8");
}

/** 按真实解码结果识别、校验并规范化上传的图片源数据。 */
export async function inspectImage(
  source: Buffer,
  originalName: string,
  config: SpriteConfig
): Promise<{ source: Buffer; format: SourceFormat; extension: string }> {
  if (source.length === 0 || source.length > config.maxUploadBytes) {
    throw new AppError("文件为空或超过上传大小限制", 413, "UPLOAD_TOO_LARGE");
  }

  // 在交给图像解码器之前先拦截可识别的 SVG 主动内容和外部资源。
  const looksLikeSvg = /<svg\b/i.test(source.subarray(0, Math.min(source.length, 4096)).toString("utf8"));
  const prevalidatedSvg = looksLikeSvg ? validateSvg(source) : undefined;

  let metadata: sharp.Metadata;
  try {
    metadata = await sharp(source, { limitInputPixels: config.maxInputPixels }).metadata();
  } catch {
    throw new AppError("文件不是可解码的 SVG、PNG、JPEG/JPG 或 WebP 图片", 415, "INVALID_IMAGE");
  }

  if (!["svg", "png", "jpeg", "webp"].includes(metadata.format ?? "")) {
    throw new AppError("仅支持 SVG、PNG、JPEG/JPG 和 WebP", 415, "UNSUPPORTED_FORMAT");
  }
  if (!metadata.width || !metadata.height || metadata.width * metadata.height > config.maxInputPixels) {
    throw new AppError("图片像素数量超过限制", 413, "PIXELS_TOO_LARGE");
  }
  if (metadata.width > config.maxInputDimension || metadata.height > config.maxInputDimension) {
    throw new AppError(
      `图片宽和高都不能超过 ${config.maxInputDimension} px，当前为 ${metadata.width}×${metadata.height}`,
      413,
      "DIMENSIONS_TOO_LARGE"
    );
  }

  const format = metadata.format as SourceFormat;
  const safeSource = format === "svg" ? prevalidatedSvg ?? validateSvg(source) : source;
  const claimedExtension = path.extname(originalName).slice(1).toLowerCase();
  const acceptedExtensions = format === "jpeg" ? ["jpg", "jpeg"] : [format];
  if (claimedExtension && !acceptedExtensions.includes(claimedExtension)) {
    throw new AppError("文件扩展名与真实图片格式不一致", 415, "FORMAT_MISMATCH");
  }

  return { source: safeSource, format, extension: format === "jpeg" ? "jpg" : format };
}

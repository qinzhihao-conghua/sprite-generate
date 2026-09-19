import sharp from "sharp";
import type { SpriteConfig } from "./types.js";

const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 } as const;

/** 将任意受支持原图等比缩放并放入固定透明单元格。 */
export async function normalizeIcon(
  source: Buffer,
  config: SpriteConfig,
  padding = config.padding,
  trimTransparent = false
): Promise<Buffer> {
  if (!Number.isInteger(padding) || padding < 0 || padding > 24) throw new Error("无效的图标边距");
  const contentSize = config.cellSize - padding * 2;

  let pipeline = sharp(source, {
    density: 192,
    limitInputPixels: config.maxInputPixels,
    failOn: "warning"
  })
    .rotate()
    .ensureAlpha();

  if (trimTransparent) {
    pipeline = pipeline.trim({ background: TRANSPARENT, threshold: 8 });
  }

  return pipeline
    .resize(contentSize, contentSize, {
      fit: "contain",
      position: "centre",
      background: TRANSPARENT,
      withoutEnlargement: false
    })
    .extend({
      top: padding,
      bottom: padding,
      left: padding,
      right: padding,
      background: TRANSPARENT
    })
    .png({ compressionLevel: 9, adaptiveFiltering: false })
    .toBuffer();
}

import path from "node:path";
import type { SpriteConfig } from "./types.js";

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function createConfig(overrides: Partial<SpriteConfig> = {}): SpriteConfig {
  const dataDir = path.resolve(overrides.dataDir ?? process.env.SPRITE_DATA_DIR ?? "data");
  const publicDir = path.resolve(overrides.publicDir ?? process.env.SPRITE_PUBLIC_DIR ?? "public");

  return {
    dataDir,
    publicDir,
    generatedDir: path.resolve(overrides.generatedDir ?? path.join(publicDir, "generated")),
    cellSize: overrides.cellSize ?? 64,
    padding: overrides.padding ?? 6,
    pixelRatio: overrides.pixelRatio ?? 2,
    columns: overrides.columns ?? 16,
    maxIcons: overrides.maxIcons ?? 1000,
    maxUploadBytes:
      overrides.maxUploadBytes ?? positiveInteger(process.env.MAX_UPLOAD_BYTES, 2 * 1024 * 1024),
    maxInputPixels:
      overrides.maxInputPixels ?? positiveInteger(process.env.MAX_INPUT_PIXELS, 4096 * 4096),
    maxInputDimension:
      overrides.maxInputDimension ?? positiveInteger(process.env.MAX_INPUT_DIMENSION, 160),
    maxBatchFiles: overrides.maxBatchFiles ?? 100,
    maxBatchBytes: overrides.maxBatchBytes ?? 20 * 1024 * 1024
  };
}

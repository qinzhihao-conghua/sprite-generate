export type Anchor = readonly [number, number];

export type AnchorType = "center" | "bottom" | "bottom-left" | "custom";

export type SourceFormat = "svg" | "png" | "jpeg" | "webp";

export interface IconRecord {
  id: string;
  name: string;
  sourceFile: string;
  sourceFormat: SourceFormat;
  anchorType: AnchorType;
  anchor: Anchor;
  displayWidth: number;
  displayHeight: number;
  padding: number;
  enabled: boolean;
  contentHash: string;
  createdAt: string;
  updatedAt: string;
}

export interface ManifestIcon {
  x: number;
  y: number;
  width: number;
  height: number;
  displayWidth: number;
  displayHeight: number;
  anchor: Anchor;
  padding: number;
}

export interface SpriteManifest {
  name: string;
  version: string;
  buildNumber: number;
  contentHash: string;
  image: string;
  manifest: string;
  stylesheet: string;
  trimTransparent: boolean;
  pixelRatio: number;
  width: number;
  height: number;
  cellSize: number;
  usages: readonly ["map", "page"];
  icons: Record<string, ManifestIcon>;
}

export interface SpriteConfig {
  projectRoot: string;
  dataDir: string;
  originalsDir: string;
  recordsFile: string;
  publicDir: string;
  generatedDir: string;
  spriteName: string;
  trimTransparent: boolean;
  cellSize: number;
  padding: number;
  pixelRatio: number;
  columns: number;
  maxIcons: number;
  maxUploadBytes: number;
  maxInputPixels: number;
  maxInputDimension: number;
  maxBatchFiles: number;
  maxBatchBytes: number;
}

export interface ProjectConfigFile {
  sourceDir: string;
  metadataFile: string;
  outputDir: string;
  spriteName?: string;
  trimTransparent?: boolean;
}

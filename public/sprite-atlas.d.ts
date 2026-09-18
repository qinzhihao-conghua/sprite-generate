export interface ManifestIcon {
  x: number; y: number; width: number; height: number;
  displayWidth: number; displayHeight: number; anchor: readonly [number, number];
}
export interface SpriteManifest {
  version: string;
  image: string;
  manifest?: string;
  stylesheet?: string;
  width: number;
  height: number;
  icons: Record<string, ManifestIcon>;
}
export class SpriteAtlas {
  constructor(manifestUrl?: string);
  manifest: SpriteManifest | null;
  image: HTMLImageElement | null;
  load(): Promise<any>;
  loadImage(): Promise<HTMLImageElement>;
  resolve(iconId: string): { iconId: string; config: ManifestIcon; missing: boolean };
  getCss(iconId: string, size?: number): Record<string, string>;
  createElement(iconId: string, options?: Record<string, string | number>): HTMLElement;
  draw(context: CanvasRenderingContext2D, iconId: string, x: number, y: number, width: number, height?: number): void;
}

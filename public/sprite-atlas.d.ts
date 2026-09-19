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
  /** 创建使用指定 manifest API 的客户端图集实例。 */
  constructor(manifestUrl?: string);
  manifest: SpriteManifest | null;
  image: HTMLImageElement | null;
  /** 加载 manifest 与 PNG 图集。 */
  load(): Promise<any>;
  /** 解码 manifest 指向的 PNG 图集。 */
  loadImage(): Promise<HTMLImageElement>;
  /** 解析 iconId，并返回缺失 ID 的降级结果。 */
  resolve(iconId: string): { iconId: string; config: ManifestIcon; missing: boolean };
  /** 计算指定图标的内联 CSS。 */
  getCss(iconId: string, size?: number): Record<string, string>;
  /** 创建应用雪碧图样式的 DOM 元素。 */
  createElement(iconId: string, options?: Record<string, string | number>): HTMLElement;
  /** 将指定图标绘制到 Canvas。 */
  draw(context: CanvasRenderingContext2D, iconId: string, x: number, y: number, width: number, height?: number): void;
}

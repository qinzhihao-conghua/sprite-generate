const CACHE_PREFIX = "sprite-atlas-manifest:";

export class SpriteAtlas {
  /** 创建使用指定 manifest API 的客户端图集实例。 */
  constructor(manifestUrl = "/api/icons/manifest") {
    this.manifestUrl = manifestUrl;
    this.manifest = null;
    this.image = null;
  }

  /** 加载 manifest 与 PNG；请求失败时尝试使用本地缓存的 manifest。 */
  async load() {
    try {
      const response = await fetch(this.manifestUrl, { cache: "no-cache" });
      if (!response.ok) throw new Error(`manifest HTTP ${response.status}`);
      this.manifest = await response.json();
      localStorage.setItem(`${CACHE_PREFIX}${this.manifestUrl}`, JSON.stringify(this.manifest));
    } catch (error) {
      const cached = localStorage.getItem(`${CACHE_PREFIX}${this.manifestUrl}`);
      if (!cached) throw error;
      this.manifest = JSON.parse(cached);
    }
    await this.loadImage();
    return this.manifest;
  }

  /** 解码 manifest 指向的当前雪碧图图片。 */
  async loadImage() {
    if (!this.manifest) throw new Error("请先加载 manifest");
    const image = new Image();
    image.decoding = "async";
    image.src = this.manifest.image;
    await image.decode();
    this.image = image;
    return image;
  }

  /** 解析 iconId；缺失时回退到 default 或图集中的首个图标。 */
  resolve(iconId) {
    if (!this.manifest) throw new Error("SpriteAtlas 尚未加载");
    const config = this.manifest.icons[iconId];
    if (config) return { iconId, config, missing: false };
    const fallbackId = this.manifest.icons.default ? "default" : Object.keys(this.manifest.icons)[0];
    if (!fallbackId) throw new Error("manifest 中没有任何图标");
    return { iconId: fallbackId, config: this.manifest.icons[fallbackId], missing: true };
  }

  /** 根据图集坐标计算指定显示尺寸的内联 CSS。 */
  getCss(iconId, size) {
    const { config } = this.resolve(iconId);
    const width = size ?? config.displayWidth;
    const height = size ?? config.displayHeight;
    const scaleX = width / config.width;
    const scaleY = height / config.height;
    return {
      display: "inline-block",
      width: `${width}px`,
      height: `${height}px`,
      flex: `0 0 ${width}px`,
      backgroundImage: `url(\"${this.manifest.image}\")`,
      backgroundRepeat: "no-repeat",
      backgroundSize: `${this.manifest.width * scaleX}px ${this.manifest.height * scaleY}px`,
      backgroundPosition: `${-config.x * scaleX}px ${-config.y * scaleY}px`
    };
  }

  /** 创建已经应用雪碧图样式和无障碍属性的 DOM 元素。 */
  createElement(iconId, options = {}) {
    const element = document.createElement(options.tagName ?? "span");
    Object.assign(element.style, this.getCss(iconId, options.size));
    element.className = options.className ?? "sprite-icon";
    element.setAttribute("role", "img");
    element.setAttribute("aria-label", options.label ?? iconId);
    element.dataset.iconId = iconId;
    return element;
  }

  /** 将指定 iconId 对应的单元格绘制到 Canvas。 */
  draw(context, iconId, x, y, width, height = width) {
    if (!this.image) throw new Error("图集图片尚未加载");
    const { config } = this.resolve(iconId);
    context.drawImage(
      this.image,
      config.x,
      config.y,
      config.width,
      config.height,
      x,
      y,
      width,
      height
    );
  }
}

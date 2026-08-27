const CACHE_PREFIX = "sprite-atlas-manifest:";

export class SpriteAtlas {
  constructor(manifestUrl = "/api/icons/manifest") {
    this.manifestUrl = manifestUrl;
    this.manifest = null;
    this.image = null;
  }

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

  async loadImage() {
    if (!this.manifest) throw new Error("请先加载 manifest");
    const image = new Image();
    image.decoding = "async";
    image.src = this.manifest.image;
    await image.decode();
    this.image = image;
    return image;
  }

  resolve(iconId) {
    if (!this.manifest) throw new Error("SpriteAtlas 尚未加载");
    const config = this.manifest.icons[iconId];
    if (config) return { iconId, config, missing: false };
    const fallbackId = this.manifest.icons.default ? "default" : Object.keys(this.manifest.icons)[0];
    if (!fallbackId) throw new Error("manifest 中没有任何图标");
    return { iconId: fallbackId, config: this.manifest.icons[fallbackId], missing: true };
  }

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

  createElement(iconId, options = {}) {
    const element = document.createElement(options.tagName ?? "span");
    Object.assign(element.style, this.getCss(iconId, options.size));
    element.className = options.className ?? "sprite-icon";
    element.setAttribute("role", "img");
    element.setAttribute("aria-label", options.label ?? iconId);
    element.dataset.iconId = iconId;
    return element;
  }

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

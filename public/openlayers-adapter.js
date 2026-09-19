/** 创建按图集版本和 iconId 复用 OpenLayers Style 的样式工厂。 */
export function createOpenLayersStyleFactory(atlas, openLayers = globalThis.ol) {
  if (!openLayers?.style) throw new Error("OpenLayers 尚未加载");
  const { Style, Icon } = openLayers.style;
  let cachedVersion = atlas.manifest.version;
  const styleCache = new Map();

  /** manifest 版本变化时清空旧 Style 缓存。 */
  function clearIfVersionChanged() {
    if (cachedVersion !== atlas.manifest.version) {
      styleCache.clear();
      cachedVersion = atlas.manifest.version;
    }
  }

  /** 返回指定 iconId 的缓存 Style，缺失 ID 由图集客户端负责降级。 */
  function getStyle(iconId) {
    clearIfVersionChanged();
    const resolved = atlas.resolve(iconId);
    if (styleCache.has(resolved.iconId)) return styleCache.get(resolved.iconId);
    const config = resolved.config;
    const style = new Style({
      image: new Icon({
        src: atlas.manifest.image,
        offset: [config.x, config.y],
        size: [config.width, config.height],
        scale: [config.displayWidth / config.width, config.displayHeight / config.height],
        anchor: config.anchor,
        anchorXUnits: "fraction",
        anchorYUnits: "fraction"
      })
    });
    styleCache.set(resolved.iconId, style);
    return style;
  }

  getStyle.cache = styleCache;
  getStyle.clear = () => styleCache.clear();
  return getStyle;
}

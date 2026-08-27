export function createOpenLayersStyleFactory(atlas, openLayers = globalThis.ol) {
  if (!openLayers?.style) throw new Error("OpenLayers 尚未加载");
  const { Style, Icon } = openLayers.style;
  let cachedVersion = atlas.manifest.version;
  const styleCache = new Map();

  function clearIfVersionChanged() {
    if (cachedVersion !== atlas.manifest.version) {
      styleCache.clear();
      cachedVersion = atlas.manifest.version;
    }
  }

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

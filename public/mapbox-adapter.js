/** 将图集中的每个单元格注册或更新为 Mapbox 可引用的图片。 */
export async function registerMapboxAtlasImages(map, atlas) {
  if (!atlas.image) await atlas.loadImage();
  for (const [iconId, config] of Object.entries(atlas.manifest.icons)) {
    const bitmap = await createImageBitmap(
      atlas.image,
      config.x,
      config.y,
      config.width,
      config.height
    );
    if (map.hasImage(iconId)) map.updateImage(iconId, bitmap);
    else map.addImage(iconId, bitmap, { pixelRatio: atlas.manifest.pixelRatio });
    bitmap.close?.();
  }
}

/** 创建按 Feature.iconId 选择图片的 Mapbox symbol layer 配置。 */
export function mapboxSymbolLayer(source, id = "point-icons") {
  return {
    id,
    type: "symbol",
    source,
    layout: {
      "icon-image": ["coalesce", ["get", "iconId"], "default"],
      "icon-allow-overlap": true,
      "icon-ignore-placement": true
    }
  };
}

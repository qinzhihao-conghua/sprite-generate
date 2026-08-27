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

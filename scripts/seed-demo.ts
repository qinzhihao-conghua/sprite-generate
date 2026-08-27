import { createConfig } from "../src/config.js";
import { AtlasPublisher } from "../src/atlas.js";
import { IconStore, sha256 } from "../src/storage.js";
import type { Anchor, AnchorType, IconRecord } from "../src/types.js";

const colors = ["#e95e3e", "#f2aa4c", "#1f7a67", "#315b8a", "#82589f", "#bd3f62", "#4f772d"];

function svgFor(index: number): Buffer {
  const color = colors[index % colors.length];
  const secondary = colors[(index + 3) % colors.length];
  const shape = index % 4;
  const body = [
    `<circle cx="50" cy="50" r="34" fill="${color}"/><path d="M32 51h36M50 33v36" stroke="white" stroke-width="10" stroke-linecap="round"/>`,
    `<path d="M50 10 91 84H9Z" fill="${color}"/><circle cx="50" cy="58" r="13" fill="${secondary}"/>`,
    `<rect x="14" y="14" width="72" height="72" rx="18" fill="${color}"/><path d="m29 52 13 13 29-33" fill="none" stroke="white" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>`,
    `<path d="M50 7c-19 0-34 15-34 34 0 26 34 53 34 53s34-27 34-53C84 22 69 7 50 7Z" fill="${color}"/><circle cx="50" cy="41" r="14" fill="white"/>`
  ][shape];
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">${body}</svg>`
  );
}

async function main() {
  const config = createConfig();
  const store = new IconStore(config.dataDir);
  const existing = new Map((await store.list()).map((record) => [record.id, record]));

  for (let index = 0; index < 100; index += 1) {
    const id = index === 0 ? "default" : `icon-${String(index).padStart(3, "0")}`;
    const source = svgFor(index);
    const contentHash = sha256(source);
    const anchorType: AnchorType = index % 4 === 3 ? "bottom" : "center";
    const anchor: Anchor = anchorType === "bottom" ? [0.5, 1] : [0.5, 0.5];
    const now = new Date().toISOString();
    const record: IconRecord = {
      id,
      name: index === 0 ? "默认图标" : `演示图标 ${index}`,
      sourceFile: `${id}.${contentHash.slice(0, 16)}.svg`,
      sourceFormat: "svg",
      anchorType,
      anchor,
      displayWidth: 32,
      displayHeight: 32,
      padding: 6,
      enabled: true,
      contentHash,
      createdAt: existing.get(id)?.createdAt ?? now,
      updatedAt: existing.get(id)?.updatedAt ?? now
    };
    await store.save(record, source);
  }

  const result = await new AtlasPublisher(config).publish(await store.list());
  console.log(`已准备 100 个图标，图集版本：${result.manifest.version}`);
  console.log(`manifest：${result.manifestUrl}`);
}

await main();

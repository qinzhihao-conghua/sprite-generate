import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { AtlasPublisher } from "../src/atlas.js";
import { IconStore, sha256 } from "../src/storage.js";
import type { IconRecord } from "../src/types.js";
import { temporaryConfig, svg } from "./helpers.js";

test("17 个图标按固定网格生成确定性 manifest，并覆盖上一版本", async () => {
  const { config } = await temporaryConfig();
  const store = new IconStore(config.dataDir);
  const source = svg();
  for (let index = 0; index < 17; index += 1) {
    const id = index === 0 ? "4-default" : `icon-${String(index).padStart(2, "0")}`;
    const record: IconRecord = {
      id,
      name: id,
      sourceFile: `${id}.svg`,
      sourceFormat: "svg",
      anchorType: "center",
      anchor: [0.5, 0.5],
      displayWidth: 32,
      displayHeight: 32,
      padding: 6,
      enabled: true,
      contentHash: sha256(source),
      createdAt: "2026-08-27T00:00:00.000Z",
      updatedAt: "2026-08-27T00:00:00.000Z"
    };
    await store.save(record, source);
  }

  const publisher = new AtlasPublisher(config);
  const first = await publisher.publish(await store.list(), "map-icons");
  const baseUrl = config.publicUrlBase;
  assert.equal(first.manifest.image, `${baseUrl}/current/map-icons.png`);
  assert.equal(first.manifest.manifest, `${baseUrl}/current/map-icons.manifest.json`);
  assert.equal(first.manifest.stylesheet, `${baseUrl}/current/map-icons.css`);
  assert.equal(first.manifest.buildNumber, 1);
  assert.equal(first.manifest.trimTransparent, false);
  assert.equal(first.manifest.width, 1024);
  assert.equal(first.manifest.height, 128);
  assert.deepEqual(first.manifest.usages, ["map", "page"]);
  assert.deepEqual(first.manifest.icons["icon-16"], {
    x: 0,
    y: 64,
    width: 64,
    height: 64,
    displayWidth: 32,
    displayHeight: 32,
    anchor: [0.5, 0.5],
    padding: 6
  });
  const stylesheet = await readFile(
    path.join(config.generatedDir, "current", path.basename(first.manifest.stylesheet)),
    "utf8"
  );
  assert.match(stylesheet, /\[class~="4-default"\],/);
  assert.match(stylesheet, /\[class~="icon-16"\] \{/);
  assert.ok(stylesheet.includes(`background-image: url("${config.publicUrlBase}/current/map-icons.png")`));
  assert.match(stylesheet, /\[class~="icon-16"\] \{[\s\S]*background-position: 0px -32px;/);
  const second = await publisher.publish(await store.list(), "map-icons");
  assert.equal(second.manifest.version, first.manifest.version);
  assert.equal(second.reused, true);

  const defaultRecord = (await store.list()).find((record) => record.id === "4-default")!;
  await store.save({ ...defaultRecord, anchorType: "bottom", anchor: [0.5, 1] }, source);
  const third = await publisher.publish(await store.list(), "map-icons");
  assert.notEqual(third.manifest.version, first.manifest.version);
  assert.equal(third.manifest.buildNumber, 2);
  assert.deepEqual(await readdir(config.generatedDir), ["current"]);
  assert.deepEqual(
    (await readdir(path.join(config.generatedDir, "current"))).sort(),
    ["current.json", "map-icons.css", "map-icons.manifest.json", "map-icons.png"]
  );
  const overwrittenManifest = JSON.parse(
    await readFile(path.join(config.generatedDir, "current", "map-icons.manifest.json"), "utf8")
  );
  assert.equal(overwrittenManifest.version, third.manifest.version);
  assert.equal(overwrittenManifest.icons["4-default"].anchor[1], 1);
  const pointer = JSON.parse(await readFile(path.join(config.generatedDir, "current", "current.json"), "utf8"));
  assert.equal(pointer.version, third.manifest.version);
});

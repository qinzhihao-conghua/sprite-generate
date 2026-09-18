import assert from "node:assert/strict";
import { readdir, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import { createApp } from "../src/app.js";
import { temporaryConfig, svg } from "./helpers.js";

test("上传、后台重建、ETag 与覆盖式图集发布形成完整闭环", async (context) => {
  const { config } = await temporaryConfig();
  const { app, services } = createApp(config);
  const server: Server = await new Promise((resolve) => {
    const listening = app.listen(0, () => resolve(listening));
  });
  context.after(() => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const form = new FormData();
  form.set("iconId", "default");
  form.set("name", "默认图标");
  form.set("anchorType", "center");
  form.set("spriteName", "map-icons");
  form.set("file", new Blob([svg().toString("utf8")], { type: "image/svg+xml" }), "default.svg");
  const upload = await fetch(`${baseUrl}/api/icons`, { method: "POST", body: form });
  assert.equal(upload.status, 201);
  await services.queue.waitForIdle();
  assert.equal(services.queue.getStatus().state, "idle");

  const manifestResponse = await fetch(`${baseUrl}/api/icons/manifest`);
  assert.equal(manifestResponse.status, 200);
  assert.equal(manifestResponse.headers.get("cache-control"), "no-cache");
  const etag = manifestResponse.headers.get("etag");
  assert.ok(etag);
  const manifest = await manifestResponse.json();
  assert.ok(manifest.icons.default);
  assert.equal(manifest.name, "map-icons");
  assert.equal(manifest.buildNumber, 1);
  assert.equal(manifest.trimTransparent, false);
  assert.equal(manifest.image, "/generated/current/map-icons.png");
  assert.equal(manifest.manifest, "/generated/current/map-icons.manifest.json");
  assert.equal(manifest.stylesheet, "/generated/current/map-icons.css");

  const notModified = await fetch(`${baseUrl}/api/icons/manifest`, { headers: { "If-None-Match": etag! } });
  assert.equal(notModified.status, 304);
  const atlas = await fetch(`${baseUrl}${manifest.image}`);
  assert.equal(atlas.status, 200);
  assert.match(manifest.image, /\.png$/);
  assert.equal(atlas.headers.get("content-type"), "image/png");
  assert.equal(atlas.headers.get("cache-control"), "no-cache");

  const stylesheetResponse = await fetch(`${baseUrl}/api/icons/stylesheet`);
  assert.equal(stylesheetResponse.status, 200);
  assert.equal(stylesheetResponse.headers.get("cache-control"), "no-cache");
  assert.match(stylesheetResponse.headers.get("content-type") ?? "", /^text\/css/);
  const stylesheetEtag = stylesheetResponse.headers.get("etag");
  assert.ok(stylesheetEtag);
  assert.match(await stylesheetResponse.text(), /\[class~="default"\] \{/);
  const stylesheetNotModified = await fetch(`${baseUrl}/api/icons/stylesheet`, {
    headers: { "If-None-Match": stylesheetEtag! }
  });
  assert.equal(stylesheetNotModified.status, 304);
  const generatedStylesheet = await fetch(`${baseUrl}${manifest.stylesheet}`);
  assert.equal(generatedStylesheet.status, 200);
  assert.equal(generatedStylesheet.headers.get("cache-control"), "no-cache");

  const jpeg = await sharp({ create: { width: 150, height: 80, channels: 3, background: "#315b8a" } })
    .jpeg()
    .toBuffer();
  const batch = new FormData();
  batch.append("files", new Blob([svg("#1f7a67").toString("utf8")], { type: "image/svg+xml" }), "default.svg");
  batch.append("files", new Blob([Uint8Array.from(jpeg)], { type: "image/jpeg" }), "camera.jpg");
  batch.append("metadata", JSON.stringify([
    { iconId: "default", name: "新版默认图标", anchorType: "center", padding: 10 },
    { iconId: "camera", name: "摄像机", anchorType: "bottom", padding: 4 }
  ]));
  batch.append("spriteName", "map-icons");
  batch.append("trimTransparent", "true");
  const batchResponse = await fetch(`${baseUrl}/api/icons/batch`, { method: "POST", body: batch });
  assert.equal(batchResponse.status, 201);
  const batchBody = await batchResponse.json();
  assert.deepEqual(batchBody.summary, { total: 2, added: 1, replaced: 1 });
  await services.queue.waitForIdle();
  assert.equal(services.queue.getStatus().lastVersion?.startsWith("v002-"), true);
  assert.equal(services.queue.getStatus().trimTransparent, true);
  const updatedManifest = await fetch(`${baseUrl}/api/icons/manifest`).then((response) => response.json());
  assert.equal(updatedManifest.trimTransparent, true);
  assert.ok(updatedManifest.icons.camera);
  assert.match(await fetch(`${baseUrl}/api/icons/stylesheet`).then((response) => response.text()), /\[class~="camera"\] \{/);
  const records = await fetch(`${baseUrl}/api/icons`).then((response) => response.json());
  assert.equal(records.find((record: { id: string }) => record.id === "default").padding, 10);
  assert.equal(records.find((record: { id: string }) => record.id === "camera").sourceFormat, "jpeg");

  await writeFile(path.join(config.dataDir, "originals", "camera.legacy.svg"), svg("#333333"));
  const remove = await fetch(`${baseUrl}/api/icons/camera`, { method: "DELETE" });
  assert.equal(remove.status, 202);
  assert.equal((await remove.json()).action, "deleted");
  await services.queue.waitForIdle();
  const withoutCamera = await fetch(`${baseUrl}/api/icons/manifest`).then((response) => response.json());
  assert.equal(withoutCamera.buildNumber, 3);
  assert.equal(withoutCamera.name, "map-icons");
  assert.equal(withoutCamera.trimTransparent, true);
  assert.equal(withoutCamera.icons.camera, undefined);
  assert.ok(withoutCamera.icons.default);
  assert.doesNotMatch(
    await fetch(`${baseUrl}/api/icons/stylesheet`).then((response) => response.text()),
    /\[class~="camera"\](?:,| \{)/
  );
  const remainingRecords = await fetch(`${baseUrl}/api/icons`).then((response) => response.json());
  assert.equal(remainingRecords.find((record: { id: string }) => record.id === "camera"), undefined);
  assert.deepEqual(
    (await readdir(path.join(config.dataDir, "originals"))).filter((file) => file.startsWith("camera.")),
    []
  );

  const overwrittenManifest = await fetch(`${baseUrl}${updatedManifest.manifest}`);
  const overwrittenAtlas = await fetch(`${baseUrl}${updatedManifest.image}`);
  assert.equal(overwrittenManifest.status, 200);
  assert.equal(overwrittenAtlas.status, 200);
  assert.equal((await overwrittenManifest.json()).icons.camera, undefined);
  assert.deepEqual(await readdir(config.generatedDir), ["current"]);

  const removeAgain = await fetch(`${baseUrl}/api/icons/camera`, { method: "DELETE" });
  assert.equal(removeAgain.status, 404);
  assert.equal((await removeAgain.json()).error, "ICON_NOT_FOUND");
  assert.equal(services.queue.getStatus().lastVersion, withoutCamera.version);
});

test("拒绝移除最后一个启用图标并保持当前版本不变", async (context) => {
  const { config } = await temporaryConfig();
  const { app, services } = createApp(config);
  const server: Server = await new Promise((resolve) => {
    const listening = app.listen(0, () => resolve(listening));
  });
  context.after(() => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const form = new FormData();
  form.set("iconId", "only-icon");
  form.set("file", new Blob([svg().toString("utf8")], { type: "image/svg+xml" }), "only.svg");
  assert.equal((await fetch(`${baseUrl}/api/icons`, { method: "POST", body: form })).status, 201);
  await services.queue.waitForIdle();
  const before = await fetch(`${baseUrl}/api/icons/manifest`).then((response) => response.json());

  const remove = await fetch(`${baseUrl}/api/icons/only-icon`, { method: "DELETE" });
  assert.equal(remove.status, 409);
  assert.equal((await remove.json()).error, "LAST_ENABLED_ICON");
  const after = await fetch(`${baseUrl}/api/icons/manifest`).then((response) => response.json());
  assert.equal(after.version, before.version);
  const records = await fetch(`${baseUrl}/api/icons`).then((response) => response.json());
  assert.equal(records[0].enabled, true);
});

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadProjectConfig, saveProjectBuildOptions } from "../src/config.js";
import { initializeProject } from "../src/project.js";
import { prepareProject } from "../src/runtime.js";
import { IconStore, sha256 } from "../src/storage.js";
import { svg } from "./helpers.js";

test("服务启动准备会自动扫描原图、保留元数据并构建图集", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "sprite-project-test-"));
  const sourceDir = path.join(root, "assets", "icons");
  await initializeProject(root, {
    sourceDir: "assets/icons",
    metadataFile: "assets/icons.metadata.json",
    outputDir: "output",
    spriteName: "project-icons"
  });
  await writeFile(path.join(sourceDir, "hospital.svg"), svg("#315b8a"));
  await writeFile(path.join(sourceDir, "camera.svg"), svg("#1f7a67"));

  const initialized = await initializeProject(root);
  assert.deepEqual(
    { imported: initialized.imported, added: initialized.added, updated: initialized.updated },
    { imported: 2, added: 2, updated: 0 }
  );

  const config = await loadProjectConfig(root);
  const store = new IconStore(config.originalsDir, config.recordsFile);
  const records = await store.list();
  assert.deepEqual(records.map((record) => record.id), ["camera", "hospital"]);
  assert.equal(records[0]?.anchorType, "center");
  assert.equal(records[0]?.padding, 6);

  records[0]!.padding = 12;
  await store.replaceAll(records);
  await writeFile(path.join(sourceDir, "camera.svg"), svg("#e95e3e"));
  const rescanned = await initializeProject(root);
  assert.equal(rescanned.updated, 1);
  assert.equal((await store.list()).find((record) => record.id === "camera")?.padding, 12);

  await saveProjectBuildOptions(config, "renamed-icons", true);
  const savedProjectConfig = JSON.parse(
    await readFile(path.join(root, "sprite-generator.config.json"), "utf8")
  );
  assert.equal(savedProjectConfig.spriteName, "renamed-icons");
  assert.equal(savedProjectConfig.trimTransparent, true);

  const prepared = await prepareProject(root);
  assert.equal(prepared.records.length, 2);
  const manifest = JSON.parse(
    await readFile(path.join(config.generatedDir, "current", "renamed-icons.manifest.json"), "utf8")
  );
  assert.equal(manifest.trimTransparent, true);
  assert.deepEqual(Object.keys(manifest.icons), ["camera", "hospital"]);
});

test("服务启动扫描拒绝无法作为 iconId 的原图文件名", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "sprite-project-invalid-"));
  await initializeProject(root, { sourceDir: "icons" });
  await writeFile(path.join(root, "icons", "中文 图标.svg"), svg());
  await assert.rejects(() => initializeProject(root), /iconId/);
});

test("启动扫描兼容历史 Hash 原图名并忽略未引用的旧版本", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "sprite-project-legacy-"));
  await initializeProject(root, {
    sourceDir: "icons",
    metadataFile: "icons.metadata.json"
  });
  const currentSource = svg("#315b8a");
  const staleSource = svg("#e95e3e");
  const currentFile = "hospital.0123456789abcdef.svg";
  await writeFile(path.join(root, "icons", currentFile), currentSource);
  await writeFile(path.join(root, "icons", "hospital.fedcba9876543210.svg"), staleSource);

  const config = await loadProjectConfig(root);
  const store = new IconStore(config.originalsDir, config.recordsFile);
  const now = new Date().toISOString();
  await store.replaceAll([
    {
      id: "hospital",
      name: "医院",
      sourceFile: currentFile,
      sourceFormat: "svg",
      anchorType: "bottom",
      anchor: [0.5, 1],
      displayWidth: 36,
      displayHeight: 36,
      padding: 10,
      enabled: true,
      contentHash: sha256(currentSource),
      createdAt: now,
      updatedAt: now
    }
  ]);

  const initialized = await initializeProject(root);
  assert.deepEqual(
    { imported: initialized.imported, added: initialized.added, updated: initialized.updated },
    { imported: 1, added: 0, updated: 0 }
  );
  const [record] = await store.list();
  assert.equal(record?.id, "hospital");
  assert.equal(record?.sourceFile, currentFile);
  assert.equal(record?.padding, 10);
  assert.equal(record?.anchorType, "bottom");
});

test("项目初始化只读取配置文件指定的目录且不会扫描父目录", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "sprite-project-boundary-"));
  await initializeProject(parent, { sourceDir: "icons" });
  await writeFile(path.join(parent, "icons", "parent-icon.svg"), svg());
  await initializeProject(parent);

  const child = path.join(parent, "dist");
  await mkdir(child);
  await writeFile(
    path.join(child, "sprite-generator.config.json"),
    `${JSON.stringify({
      sourceDir: "configured/source",
      metadataFile: "configured/metadata.json",
      outputDir: "configured/output",
      spriteName: "configured-sprite",
      trimTransparent: false
    })}\n`
  );
  const prepared = await prepareProject(child);
  assert.equal(prepared.config.projectRoot, child);
  assert.equal(prepared.config.originalsDir, path.join(child, "configured", "source"));
  assert.equal(prepared.config.recordsFile, path.join(child, "configured", "metadata.json"));
  assert.equal(prepared.config.generatedDir, path.join(child, "configured", "output"));
  assert.equal(prepared.records.length, 0);
  assert.equal(prepared.initialized.imported, 0);
});

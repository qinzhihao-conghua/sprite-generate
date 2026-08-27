import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { normalizeIcon } from "../src/normalize.js";
import {
  inspectImage,
  parseAnchor,
  parsePadding,
  validateIconId,
  validateSpriteName
} from "../src/validation.js";
import { temporaryConfig, svg } from "./helpers.js";

test("标准化输出固定 64×64 透明画布并保留内容", async () => {
  const { config } = await temporaryConfig();
  const output = await normalizeIcon(svg(), config);
  const metadata = await sharp(output).metadata();
  assert.equal(metadata.width, 64);
  assert.equal(metadata.height, 64);
  assert.equal(metadata.hasAlpha, true);
});

test("全局裁边开关可在保留透明边界和先裁边之间切换", async () => {
  const { config } = await temporaryConfig();
  const source = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160"><rect x="40" y="40" width="80" height="80" fill="red"/></svg>'
  );
  const preserved = await normalizeIcon(source, config, 0, false);
  const trimmed = await normalizeIcon(source, config, 0, true);
  const preservedVisible = await sharp(await sharp(preserved).trim().toBuffer()).metadata();
  const trimmedVisible = await sharp(await sharp(trimmed).trim().toBuffer()).metadata();
  assert.deepEqual([preservedVisible.width, preservedVisible.height], [32, 32]);
  assert.deepEqual([trimmedVisible.width, trimmedVisible.height], [64, 64]);
});

test("不同原始尺寸与边距均能标准化，较大边距会缩小内容区域", async () => {
  const { config } = await temporaryConfig();
  const wide = await sharp({ create: { width: 160, height: 24, channels: 3, background: "#315b8a" } })
    .jpeg()
    .toBuffer();
  const smallPadding = await normalizeIcon(wide, config, 2);
  const largePadding = await normalizeIcon(wide, config, 18);
  const smallTrimmed = await sharp(await sharp(smallPadding).trim().toBuffer()).metadata();
  const largeTrimmed = await sharp(await sharp(largePadding).trim().toBuffer()).metadata();
  assert.equal((smallTrimmed.width ?? 0) > (largeTrimmed.width ?? 0), true);
  assert.deepEqual([smallTrimmed.width, smallTrimmed.height], [60, 9]);
  assert.deepEqual([largeTrimmed.width, largeTrimmed.height], [28, 4]);
});

test("使用真实解码格式，拒绝伪装扩展名", async () => {
  const { config } = await temporaryConfig();
  await assert.rejects(() => inspectImage(svg(), "fake.png", config), /扩展名与真实图片格式不一致/);
  const inspected = await inspectImage(svg(), "valid.svg", config);
  assert.equal(inspected.format, "svg");
});

test("接受 JPG/JPEG 输入", async () => {
  const { config } = await temporaryConfig();
  const jpeg = await sharp({ create: { width: 160, height: 90, channels: 3, background: "#e95e3e" } })
    .jpeg()
    .toBuffer();
  const inspected = await inspectImage(jpeg, "photo.jpg", config);
  assert.equal(inspected.format, "jpeg");
  assert.equal(inspected.extension, "jpg");
});

test("拒绝任一边超过 160 px 的图片", async () => {
  const { config } = await temporaryConfig();
  const oversized = await sharp({ create: { width: 161, height: 80, channels: 3, background: "#e95e3e" } })
    .png()
    .toBuffer();
  await assert.rejects(() => inspectImage(oversized, "oversized.png", config), /不能超过 160 px/);
});

test("拒绝危险 SVG 脚本、事件和外部引用", async () => {
  const { config } = await temporaryConfig();
  const cases = [
    svg("red", "<script>alert(1)</script>"),
    svg("red", '<image href="https://evil.example/a.png"/>'),
    svg("red", '<rect onclick="alert(1)"/>'),
    svg("red", "<foreignObject><div>bad</div></foreignObject>")
  ];
  for (const source of cases) {
    await assert.rejects(() => inspectImage(source, "unsafe.svg", config), /包含脚本、事件、外部资源或不安全元素/);
  }
});

test("iconId 与锚点校验", () => {
  assert.equal(validateIconId("hospital-01"), "hospital-01");
  assert.throws(() => validateIconId("../hospital"), /iconId/);
  assert.deepEqual(parseAnchor("bottom", undefined, undefined).anchor, [0.5, 1]);
  assert.deepEqual(parseAnchor("custom", "0.2", "0.8").anchor, [0.2, 0.8]);
  assert.throws(() => parseAnchor("custom", "2", "0.8"), /0～1/);
  assert.equal(parsePadding("12"), 12);
  assert.throws(() => parsePadding("25"), /0～24/);
  assert.equal(validateSpriteName("地图图标-01"), "地图图标-01");
  assert.throws(() => validateSpriteName("../sprite"), /雪碧图名称/);
});

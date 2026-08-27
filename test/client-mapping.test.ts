import assert from "node:assert/strict";
import test from "node:test";
import { SpriteAtlas } from "../public/sprite-atlas.js";

test("普通页面 CSS 映射由 manifest 计算，不硬编码坐标", () => {
  const atlas = new SpriteAtlas();
  atlas.manifest = {
    version: "test",
    image: "/atlas.png",
    width: 128,
    height: 64,
    icons: {
      default: { x: 0, y: 0, width: 64, height: 64, displayWidth: 32, displayHeight: 32, anchor: [0.5, 0.5] },
      camera: { x: 64, y: 0, width: 64, height: 64, displayWidth: 40, displayHeight: 24, anchor: [0.5, 0.5] }
    }
  };
  const css = atlas.getCss("camera");
  assert.equal(css.width, "40px");
  assert.equal(css.height, "24px");
  assert.equal(css.backgroundSize, "80px 24px");
  assert.equal(css.backgroundPosition, "-40px 0px");
  assert.equal(atlas.resolve("missing").iconId, "default");
});

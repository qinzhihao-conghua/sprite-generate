import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("CSS 雪碧图卡片通过悬停删除且不再展示独立管理表", async () => {
  const [html, script, styles] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8")
  ]);

  assert.doesNotMatch(html, /management-rows|图集图标管理/);
  assert.match(html, /鼠标移入图标可永久删除/);
  assert.match(script, /className: "gallery-delete"/);
  assert.match(script, /gallery\.addEventListener\("click"/);
  assert.match(script, /确定永久删除图标/);
  assert.match(script, /method: "DELETE"/);
  assert.match(styles, /\.gallery-item:hover \.gallery-delete/);
  assert.match(styles, /\.gallery-item:focus-within \.gallery-delete/);
  assert.match(styles, /@media \(hover: none\)/);
});

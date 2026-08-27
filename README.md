# 图标标准化与通用雪碧图 MVP

这是需求方案的可运行实现：单张或批量上传 SVG、PNG、JPEG/JPG 或 WebP 后，服务端校验真实格式与 SVG 安全性，可按全局选项选择“保留完整原图”或“先裁掉透明边界”，然后等比缩放到 64×64 透明画布，再生成带可读名称、递增版本和内容 Hash 的透明 PNG 图集及 manifest。原图宽高均不能超过 160 px。鼠标移入普通页面 CSS 图标卡片即可永久删除该图标。

同一份图集既服务 OpenLayers 地图，也可用于普通页面的按钮、列表、状态卡片和 Canvas。所有消费端只传 `iconId`，不保存或硬编码雪碧图坐标。

## 快速开始

要求 Node.js 20 或更高版本。

```bash
pnpm install
pnpm seed
pnpm dev
```

访问 `http://localhost:3000`。演示包含：

- 100 种图标、1000 个 OpenLayers 点位；
- 同一图集驱动的普通页面图标墙；
- CSS 图标卡片悬停删除入口；
- 批量上传和替换图标表格，可为每张图设置 ID、锚点和边距；
- 独立图片基线与图集实际请求数对比。

运行检查：

```bash
pnpm check
```

## 实现结构

```text
上传文件
  └─ 真实格式/大小/像素/SVG 安全校验
      └─ 原图与稳定 iconId 元数据
          └─ 合并式后台重建队列
              └─ 可选透明裁边 → 等比缩放 → 64×64 单元格
                  └─ 透明 PNG + manifest（不可变版本目录）
                      └─ 校验文件可读 → 原子切换 current.json
                          ├─ OpenLayers Style 缓存
                          ├─ Mapbox addImage 适配器
                          └─ 普通页面 CSS / Canvas 适配器
```

关键文件：

- `src/validation.ts`：真实格式、上传约束、SVG 安全、iconId 和锚点校验；
- `src/normalize.ts`：可选透明裁边、等比缩放和透明画布标准化；
- `src/atlas.ts`：固定网格、内容 Hash、不可变文件和原子发布；
- `src/storage.ts`：原图与元数据的原子写入，以及图标记录和同 ID 原图的物理删除；
- `src/queue.ts`：上传请求外异步重建，并合并连续任务；
- `src/app.ts`：上传、manifest、状态接口和缓存响应头；
- `public/sprite-atlas.js`：地图外 CSS/DOM/Canvas 通用客户端；
- `public/openlayers-adapter.js`：按 iconId 缓存 OpenLayers Style；
- `public/mapbox-adapter.js`：一次加载图集并用 `addImage()` 注册；
- `scripts/seed-demo.ts`：生成 100 种演示图标；
- `test/`：标准化、坐标、版本、缓存、安全及普通页面映射测试。

## API

### 上传或替换

`POST /api/icons`，兼容的单张上传接口。`POST /api/icons/batch` 是页面使用的批量上传接口：

- `file`/`files`：SVG、PNG、JPEG/JPG 或 WebP，单张默认最大 2 MiB，整批最大 20 MiB；
- `iconId`：稳定业务 ID；
- `name`：展示名称；
- `anchorType`：`center`、`bottom`、`bottom-left` 或 `custom`；
- `anchorX`、`anchorY`：自定义锚点时使用，范围 0～1；
- `displayWidth`、`displayHeight`：可选，默认 32 CSS 像素。
- `padding`：标准化边距，0～24 px，默认 6 px；
- 批量接口的 `metadata` 是与 `files` 顺序一致的 JSON 数组。
- `spriteName`：雪碧图基础名称，默认 `sprite`；输出示例为 `sprite.v001.a1b2c3d4.png`。
- `trimTransparent`：批次级全局选项；`true` 表示所有图标先裁掉透明边界再等比缩放，默认 `false`。

追加与替换规则：

- 上传新的 `iconId`：追加一个图标；
- 上传已经存在的 `iconId`：替换该 ID 的图片和设置，业务引用保持不变；
- 不直接重命名已有 `iconId`。需要更换 ID 时，应新增 ID、迁移业务数据引用，再删除旧 ID。
- 页面默认 ID 使用“前缀 + 现有图标数量自增”，例如已有 100 个图标时默认从 `icon-101` 开始；前缀可修改。

本系统内追加时不需要手动提交旧 manifest 和 PNG，因为服务端保留了 `data/icons.json` 与原始图片。运行时部署必须同时持有匹配的 manifest 和 PNG。若向外部图集追加，仅有 manifest 与 PNG 不足以无损重建，建议同时保留每个原图及其锚点、边距等元数据。

### 物理删除

`DELETE /api/icons/:iconId` 会永久删除该 `iconId` 的元数据记录和服务端保存的同 ID 原图，然后后台发布一对不含该图标的新 PNG/manifest：

- 删除不可恢复；如需再次使用，必须重新上传；
- 至少保留一个启用图标，删除最后一个图标会返回 `409 LAST_ENABLED_ICON`；
- 删除不存在的 ID 返回 `404 ICON_NOT_FOUND`；
- 历史版本 PNG/manifest 不会被删除，仍可用于缓存和回退；
- 删除失败或新图集生成失败时不会切换 `current.json`。

### 读取与重建

- `GET /api/icons/manifest`：当前 manifest，使用 `no-cache` 和 ETag；
- `GET /api/icons/rebuild`：后台任务状态；
- `POST /api/icons/rebuild`：手动排队重建；
- `GET /api/icons`：图标元数据列表。

版本目录中的图集和 manifest 使用 `Cache-Control: public, max-age=31536000, immutable`。旧版本不会在发布新版本时删除；若生成失败，`current.json` 保持指向上一可用版本。

## 普通页面使用

```js
import { SpriteAtlas } from "/sprite-atlas.js";

const atlas = new SpriteAtlas();
await atlas.load();

document.querySelector("button").prepend(
  atlas.createElement("hospital", { size: 24, label: "医院" })
);

atlas.draw(canvas.getContext("2d"), "hospital", 10, 10, 32);
```

`SpriteAtlas` 会根据 manifest 计算 CSS 和 Canvas 裁切区域。manifest 请求失败时会尝试使用本地缓存的上一版本；缺失 `iconId` 会回退到 `default`。

## 性能验收口径

演示页通过 Resource Timing 记录图标资源请求。在 100 种图标、1000 个点位场景中：

| 方案 | manifest 请求 | 图集/图标图片请求 | 合计 |
|---|---:|---:|---:|
| 独立图片基线 | 0 | 100 | 约 100 |
| 自动图集首次访问 | 1 | 1 | 2 |
| 自动图集二次访问 | 1（可 304） | 0（强缓存） | 0～1 次网络传输 |

地图与普通页面同时出现时仍共享这一张图集，不按点位数或页面组件数增加图片请求。

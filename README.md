# 图标标准化与通用雪碧图 MVP

这是需求方案的可运行实现：单张或批量上传 SVG、PNG、JPEG/JPG 或 WebP 后，服务端校验真实格式与 SVG 安全性，可按全局选项选择“保留完整原图”或“先裁掉透明边界”，然后等比缩放到 64×64 透明画布，再生成透明 PNG 图集、manifest 与按 iconId 生成的 CSS。每次生成直接覆盖当前产物，不保留历史版本。原图宽高均不能超过 160 px。鼠标移入普通页面 CSS 图标卡片即可永久删除该图标。

同一份图集既服务 OpenLayers 地图，也可用于普通页面的按钮、列表、状态卡片和 Canvas。所有消费端只传 `iconId`，不保存或硬编码雪碧图坐标。

## 作为项目级工具使用

要求 Node.js 20 或更高版本。本工具不需要 Nginx，也不需要常驻公共服务；每个业务项目保存自己的原图、元数据和生成产物，开发人员只在维护图标时启动本地页面。

构建自包含的单文件工具：

```bash
pnpm install --frozen-lockfile
pnpm build
```

命令会生成入口文件：

```text
dist/
└─ sprite-generator.js
```

只需把 `dist/sprite-generator.js` 复制到业务项目根目录。这个 JS 已经压缩嵌入服务代码、管理页面、OpenLayers、Sharp 及其原生图像库；业务项目不需要复制 `node_modules`，也不需要执行 npm/pnpm 安装命令。

由于 Sharp 带有原生模块，单文件产物绑定构建时的操作系统和 CPU 架构。例如在 Windows x64 上构建的入口应在 Windows x64 上运行；要支持其他平台，应在对应平台重新执行 `pnpm build`。入口第一次启动时会把内嵌运行内容释放到操作系统临时缓存，后续启动直接复用该缓存。

业务项目第一次接入时，把完整原图放在 `src/assets/icons`，文件名即默认 `iconId`，然后在业务项目根目录直接运行 JS 文件：

```bash
node sprite-generator.js
```

服务启动时会自动完成以下工作，开发人员不需要额外命令：

- 没有配置时创建默认 `sprite-generator.config.json`；
- 扫描原图目录并用文件名同步 `iconId` 元数据；
- 保留已有图标的锚点、边距和显示尺寸；
- 根据完整原图自动重建当前图集；
- 启动仅监听 `127.0.0.1:3000` 的本地管理页面。

浏览器访问 `http://127.0.0.1:3000`。追加或替换完成后按 `Ctrl+C` 关闭服务，并把原图、元数据和生成结果一起提交到当前业务项目。

默认会在业务项目根目录创建：

```json
{
  "sourceDir": "src/assets/icons",
  "metadataFile": "src/assets/icons.metadata.json",
  "outputDir": "public/generated",
  "spriteName": "sprite",
  "trimTransparent": false
}
```

配置文件名为 `sprite-generator.config.json`，目录都相对于业务项目根目录。需要使用其他目录时，在启动前直接修改这个文件即可。

项目之间的配置、原图和产物完全隔离。原图文件名必须符合 `iconId` 规则；例如 `hospital.svg` 对应 `hospital`。如果不同扩展名使用相同文件名，服务启动扫描时会拒绝导入，避免产生重复 ID。

开发本工具本身时仍可使用：

```bash
pnpm seed
pnpm dev
pnpm check
```

## 实现结构

```text
上传文件
  └─ 真实格式/大小/像素/SVG 安全校验
      └─ 原图与稳定 iconId 元数据
          └─ 合并式后台重建队列
              └─ 可选透明裁边 → 等比缩放 → 64×64 单元格
                  └─ 临时生成透明 PNG + manifest + CSS
                      └─ 校验文件可读 → 整体覆盖 generated/current
                          ├─ OpenLayers Style 缓存
                          ├─ Mapbox addImage 适配器
                          └─ 普通页面 CSS / Canvas 适配器
```

关键文件：

- `src/validation.ts`：真实格式、上传约束、SVG 安全、iconId 和锚点校验；
- `src/normalize.ts`：可选透明裁边、等比缩放和透明画布标准化；
- `src/atlas.ts`：固定网格、内容 Hash、按 iconId 生成 CSS 和覆盖式发布；
- `src/storage.ts`：原图与元数据的原子写入，以及图标记录和同 ID 原图的物理删除；
- `src/project.ts`：扫描项目原图并初始化/同步元数据；
- `src/runtime.ts`：启动前自动扫描、重建并启动本地服务；
- `src/queue.ts`：上传请求外异步重建，并合并连续任务；
- `src/app.ts`：上传、manifest、状态接口和缓存响应头；
- `public/sprite-atlas.js`：地图外 CSS/DOM/Canvas 通用客户端；
- `public/openlayers-adapter.js`：按 iconId 缓存 OpenLayers Style；
- `public/mapbox-adapter.js`：一次加载图集并用 `addImage()` 注册；
- `scripts/build-standalone.ts`：把服务、页面和生产依赖压缩嵌入单文件入口；
- `scripts/clean-dist.ts`：清理临时编译目录和旧构建产物；
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
- `spriteName`：雪碧图基础名称，默认 `sprite`；输出为 `/generated/current/sprite.png`、`sprite.manifest.json` 和 `sprite.css`。
- `trimTransparent`：批次级全局选项；`true` 表示所有图标先裁掉透明边界再等比缩放，默认 `false`。

追加与替换规则：

- 上传新的 `iconId`：追加一个图标；
- 上传已经存在的 `iconId`：替换该 ID 的图片和设置，业务引用保持不变；
- 不直接重命名已有 `iconId`。需要更换 ID 时，应新增 ID、迁移业务数据引用，再删除旧 ID。
- 页面默认 ID 使用“前缀 + 现有图标数量自增”，例如已有 100 个图标时默认从 `icon-101` 开始；前缀可修改。

本系统内追加时不需要重新选择旧图标，因为完整原图和元数据已经保存在当前业务项目的 `sourceDir` 与 `metadataFile` 中。每次追加都会从项目数据重新生成匹配的 PNG、manifest 与 CSS。

最小追加请求只需要：

- `file`：这次新增图标的原始图片；
- `iconId`：新的稳定业务 ID。若该 ID 已存在，则语义是替换而不是追加。

其余图标元数据均可省略：`name` 默认等于 `iconId`，`anchorType` 默认 `center`，`displayWidth`/`displayHeight` 默认 `32`，`padding` 默认 `6`。`spriteName` 和 `trimTransparent` 省略时会继承当前图集设置，不会因最小请求而重置。批量接口仍需用 `metadata` 数组把每个 `iconId` 与同顺序的文件对应起来，但每项只写 `iconId` 即可。

开发人员不需要单独携带历史原图；它们跟随业务项目版本库。克隆项目后安装工具包，即可在相同数据基础上继续追加。原图和元数据必须同时提交，只提交生成后的 PNG/manifest/CSS 无法安全恢复后续重建能力。

### 物理删除

`DELETE /api/icons/:iconId` 会永久删除该 `iconId` 的元数据记录和服务端保存的同 ID 原图，然后后台发布一组不含该图标的新 PNG/manifest/CSS：

- 删除不可恢复；如需再次使用，必须重新上传；
- 至少保留一个启用图标，删除最后一个图标会返回 `409 LAST_ENABLED_ICON`；
- 删除不存在的 ID 返回 `404 ICON_NOT_FOUND`；
- 新产物发布成功后会覆盖并删除上一组 PNG/manifest/CSS，不提供历史版本回退；
- 生成失败时不会覆盖当前仍可用的产物。

### 读取与重建

- `GET /api/icons/manifest`：当前 manifest，使用 `no-cache` 和 ETag；
- `GET /api/icons/stylesheet`：当前 CSS，使用 `no-cache` 和 ETag，可直接放入 HTML 的 `<link>`；
- `GET /api/icons/rebuild`：后台任务状态；
- `POST /api/icons/rebuild`：手动排队重建；
- `GET /api/icons`：图标元数据列表。

当前图集、manifest 和 CSS 使用 `Cache-Control: no-cache`，确保稳定 URL 被覆盖后浏览器会重新验证。发布过程先在临时目录完成并校验，再整体替换 `/generated/current`；成功后不保留上一版本。

## 普通页面使用

HTML 标签无需 JavaScript 计算坐标。引入当前样式表后，直接把 `iconId` 作为类名：

```html
<link rel="stylesheet" href="/api/icons/stylesheet" />

<span class="hospital" role="img" aria-label="医院"></span>
<i class="camera" role="img" aria-label="摄像机"></i>
```

也可以使用 manifest 的 `stylesheet` 字段获取当前 CSS 地址。每个 ID 类已经包含显示尺寸、雪碧图地址、`background-size` 和 `background-position`；默认尺寸取上传时保存的 `displayWidth`/`displayHeight`。

需要 Canvas、缺失 ID 回退或运行时自定义尺寸时，仍可使用 JS 客户端：

```js
import { SpriteAtlas } from "/sprite-atlas.js";

const atlas = new SpriteAtlas();
await atlas.load();

document.querySelector("button").prepend(
  atlas.createElement("hospital", { size: 24, label: "医院" })
);

atlas.draw(canvas.getContext("2d"), "hospital", 10, 10, 32);
```

`SpriteAtlas` 会根据 manifest 计算自定义尺寸的 CSS 和 Canvas 裁切区域。manifest 请求失败时会尝试使用本地缓存的上一版本；缺失 `iconId` 会回退到 `default`。

## 性能验收口径

演示页通过 Resource Timing 记录图标资源请求。在 100 种图标、1000 个点位场景中：

| 方案 | manifest 请求 | CSS 请求 | 图集/图标图片请求 | 合计 |
|---|---:|---:|---:|---:|
| 独立图片基线 | 0 | 0 | 100 | 约 100 |
| 演示页首次访问 | 1 | 1 | 1 | 3 |
| 演示页二次访问 | 1（可 304） | 1（可 304） | 1（可 304） | 0～3 次网络传输 |

纯 HTML 页面只引入 CSS 时不请求 manifest，首次访问为 CSS 与 PNG 各 1 个请求。

地图与普通页面同时出现时仍共享这一张图集，不按点位数或页面组件数增加图片请求。

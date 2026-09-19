import { SpriteAtlas } from "./sprite-atlas.js";

const status = document.querySelector("#status");
const gallery = document.querySelector("#gallery");
const metrics = document.querySelector("#metrics");
const fileInput = document.querySelector("#file-input");
const spriteNameInput = document.querySelector("#sprite-name");
const idPrefixInput = document.querySelector("#id-prefix");
const trimTransparentInput = document.querySelector("#trim-transparent");
const spriteImagePath = document.querySelector("#sprite-image-path");
const spriteManifestPath = document.querySelector("#sprite-manifest-path");
const spriteStylesheetPath = document.querySelector("#sprite-stylesheet-path");
const batchRows = document.querySelector("#batch-rows");
const batchEmpty = document.querySelector("#batch-empty");
const batchTableWrap = document.querySelector("#batch-table-wrap");
const batchSummary = document.querySelector("#batch-summary");
const uploadSubmit = document.querySelector("#upload-submit");
const atlas = new SpriteAtlas();
const existingIds = new Set();
let batchItems = [];

/* standalone:openlayers:start */
/** 为地图演示生成可重复的伪随机小数。 */
function seeded(index) {
  const value = Math.sin(index * 999.91) * 43758.5453;
  return value - Math.floor(value);
}
/* standalone:openlayers:end */

/** 更新图标数量、资源请求数和可选地图点位指标。 */
function showMetrics(iconCount) {
  const resources = performance.getEntriesByType("resource");
  const manifestRequests = resources.filter((item) => item.name.includes("/api/icons/manifest")).length;
  const stylesheetRequests = resources.filter((item) => item.name.includes("/api/icons/stylesheet")).length;
  const atlasRequests = resources.filter((item) => item.name.includes("/generated/current/") && item.name.endsWith(".png")).length;
  const mapMetric = document.querySelector("#map")
    ? "<div><strong>1000</strong><span>地图点位</span></div>"
    : "";
  metrics.innerHTML = `
    <div><strong>${iconCount}</strong><span>图标种类</span></div>
    ${mapMetric}
    <div><strong>${manifestRequests + stylesheetRequests + atlasRequests}</strong><span>实际图标请求</span></div>
    <div><strong>${iconCount}</strong><span>独立图片基线请求</span></div>`;
}

/** 按 manifest 中的 iconId 重绘 CSS 图标墙。 */
function renderGallery(iconIds) {
  const fragment = document.createDocumentFragment();
  for (const iconId of iconIds) {
    const item = document.createElement("div");
    item.className = "gallery-item";
    item.append(field("span", {
      className: iconId,
      role: "img",
      ariaLabel: `页面图标 ${iconId}`
    }));
    const label = document.createElement("span");
    label.className = "gallery-label";
    label.textContent = iconId;
    const deleteButton = field("button", {
      type: "button",
      className: "gallery-delete",
      textContent: "删除",
      disabled: iconIds.length === 1,
      title: iconIds.length === 1 ? "图集中至少需要保留一个图标" : `永久删除 ${iconId}`
    });
    deleteButton.dataset.iconId = iconId;
    deleteButton.setAttribute("aria-label", `永久删除图标 ${iconId}`);
    item.append(label, deleteButton);
    fragment.append(item);
  }
  gallery.replaceChildren(fragment);
}

/* standalone:openlayers:start */
/** 使用同一份图集在 OpenLayers 中渲染 1000 个演示点位。 */
async function renderMap(iconIds) {
  const { createOpenLayersStyleFactory } = await import("./openlayers-adapter.js");
  const { Map, View, Feature } = globalThis.ol;
  const { Point } = globalThis.ol.geom;
  const { Tile: TileLayer, Vector: VectorLayer } = globalThis.ol.layer;
  const { OSM, Vector: VectorSource } = globalThis.ol.source;
  const { fromLonLat } = globalThis.ol.proj;
  const features = Array.from({ length: 1000 }, (_, index) => {
    const longitude = 116.397 + (seeded(index) - 0.5) * 0.5;
    const latitude = 39.908 + (seeded(index + 1000) - 0.5) * 0.35;
    return new Feature({
      geometry: new Point(fromLonLat([longitude, latitude])),
      iconId: iconIds[index % iconIds.length]
    });
  });
  const getStyle = createOpenLayersStyleFactory(atlas);
  const vectorLayer = new VectorLayer({
    source: new VectorSource({ features }),
    style: (feature) => getStyle(feature.get("iconId")),
    declutter: false
  });
  new Map({
    target: "map",
    layers: [new TileLayer({ source: new OSM() }), vectorLayer],
    view: new View({ center: fromLonLat([116.397, 39.908]), zoom: 10 })
  });
  document.querySelector("#style-cache-count").textContent = String(getStyle.cache.size || iconIds.length);
}
/* standalone:openlayers:end */

/** 移除文件名最后一个扩展名，作为默认展示名称。 */
function baseName(filename) {
  return filename.replace(/\.[^.]+$/, "");
}

/** 根据前缀和现有数量生成当前批次内不重复的默认 iconId。 */
function candidateId(index, used) {
  const prefix = idPrefixInput.value.trim() || "icon";
  let number = existingIds.size + index + 1;
  let candidate = `${prefix}-${String(number).padStart(3, "0")}`;
  while (used.has(candidate) || existingIds.has(candidate)) {
    number += 1;
    candidate = `${prefix}-${String(number).padStart(3, "0")}`;
  }
  used.add(candidate);
  return candidate;
}

/** 将当前 manifest 的三类生成物路径写入页面链接。 */
function renderOutputPaths(manifest) {
  spriteImagePath.href = manifest.image;
  spriteImagePath.textContent = manifest.image;
  spriteManifestPath.href = manifest.manifest;
  spriteManifestPath.textContent = manifest.manifest;
  spriteStylesheetPath.href = manifest.stylesheet;
  spriteStylesheetPath.textContent = manifest.stylesheet;
}

/** 创建元素并批量赋值 DOM 属性。 */
function field(tag, attributes = {}) {
  const element = document.createElement(tag);
  Object.assign(element, attributes);
  return element;
}

/** 统计当前批次中的新增与替换数量。 */
function updateBatchSummary() {
  const added = batchItems.filter((item) => !existingIds.has(item.iconId)).length;
  const replaced = batchItems.length - added;
  batchSummary.textContent = batchItems.length
    ? `共 ${batchItems.length} 张：新增 ${added}，替换 ${replaced}`
    : "尚未选择图片";
}

/** 根据已选文件和逐图设置重绘批量编辑表格。 */
function renderBatchRows() {
  const fragment = document.createDocumentFragment();
  batchItems.forEach((item) => {
    const row = document.createElement("tr");
    const previewCell = document.createElement("td");
    const preview = field("img", { className: "upload-preview", alt: "" });
    const objectUrl = URL.createObjectURL(item.file);
    preview.src = objectUrl;
    preview.addEventListener("load", () => {
      const dimensionElement = row.querySelector(".file-dimensions");
      dimensionElement.textContent = `${preview.naturalWidth}×${preview.naturalHeight} · ${Math.ceil(item.file.size / 1024)} KiB`;
      URL.revokeObjectURL(objectUrl);
    });
    previewCell.append(preview);

    const fileCell = document.createElement("td");
    fileCell.append(
      field("strong", { textContent: item.file.name }),
      field("small", { className: "file-dimensions", textContent: `${Math.ceil(item.file.size / 1024)} KiB` })
    );

    const actionCell = document.createElement("td");
    const badge = field("span", { className: "action-badge" });
    actionCell.append(badge);

    const idCell = document.createElement("td");
    const idInput = field("input", {
      value: item.iconId,
      required: true,
      pattern: "[A-Za-z0-9][A-Za-z0-9_-]{0,63}",
      title: "以字母或数字开头，只能包含字母、数字、短横线和下划线"
    });
    /** 根据输入的 iconId 刷新当前行的新增/替换标记。 */
    const refreshAction = () => {
      item.iconId = idInput.value.trim();
      const replacing = existingIds.has(item.iconId);
      badge.textContent = replacing ? "替换" : "新增";
      badge.className = `action-badge ${replacing ? "replace" : "add"}`;
      updateBatchSummary();
    };
    idInput.addEventListener("input", () => {
      item.autoId = false;
      refreshAction();
    });
    idCell.append(idInput);

    const nameCell = document.createElement("td");
    const nameInput = field("input", { value: item.name, required: true, maxLength: 100 });
    nameInput.addEventListener("input", () => { item.name = nameInput.value; });
    nameCell.append(nameInput);

    const anchorCell = document.createElement("td");
    const anchorSelect = document.createElement("select");
    for (const [value, label] of [["center", "中心"], ["bottom", "底部中心"], ["bottom-left", "左下角"]]) {
      anchorSelect.append(field("option", { value, textContent: label }));
    }
    anchorSelect.value = item.anchorType;
    anchorSelect.addEventListener("change", () => { item.anchorType = anchorSelect.value; });
    anchorCell.append(anchorSelect);

    const paddingCell = document.createElement("td");
    const paddingInput = field("input", { type: "number", min: 0, max: 24, step: 1, value: item.padding, required: true });
    paddingInput.addEventListener("input", () => { item.padding = Number(paddingInput.value); });
    paddingCell.append(paddingInput);

    row.append(previewCell, fileCell, actionCell, idCell, nameCell, anchorCell, paddingCell);
    fragment.append(row);
    refreshAction();
  });
  batchRows.replaceChildren(fragment);
  batchEmpty.hidden = batchItems.length > 0;
  batchTableWrap.hidden = batchItems.length === 0;
  uploadSubmit.disabled = batchItems.length === 0;
  updateBatchSummary();
}

fileInput.addEventListener("change", () => {
  const used = new Set();
  batchItems = [...fileInput.files].map((file, index) => ({
    file,
    iconId: candidateId(index, used),
    name: baseName(file.name),
    anchorType: "center",
    padding: 6,
    autoId: true
  }));
  renderBatchRows();
});

idPrefixInput.addEventListener("input", () => {
  const used = new Set(batchItems.filter((item) => !item.autoId).map((item) => item.iconId));
  batchItems.forEach((item, index) => {
    if (item.autoId) item.iconId = candidateId(index, used);
  });
  renderBatchRows();
});

/** 轮询后台队列，直到重建成功、失败或超时。 */
async function waitForRebuild() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const response = await fetch("/api/icons/rebuild", { cache: "no-store" });
    const state = await response.json();
    if (state.state === "idle") return state;
    if (state.state === "failed") throw new Error(state.lastError ?? "图集生成失败");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("图集重建超时，请稍后刷新页面查看状态");
}

document.querySelector("#upload-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!event.currentTarget.reportValidity() || batchItems.length === 0) return;
  const ids = batchItems.map((item) => item.iconId);
  if (new Set(ids).size !== ids.length) {
    status.textContent = "同一批次中 iconId 不能重复。";
    return;
  }
  uploadSubmit.disabled = true;
  status.textContent = `正在上传 ${batchItems.length} 张图片…`;
  try {
    const formData = new FormData();
    batchItems.forEach((item) => formData.append("files", item.file, item.file.name));
    formData.append("spriteName", spriteNameInput.value.trim());
    formData.append("trimTransparent", String(trimTransparentInput.checked));
    formData.append("metadata", JSON.stringify(batchItems.map(({ iconId, name, anchorType, padding }) => ({
      iconId, name, anchorType, padding
    }))));
    const response = await fetch("/api/icons/batch", { method: "POST", body: formData });
    const body = await response.json();
    if (!response.ok) throw new Error(body.message);
    status.textContent = `${body.message}，等待新版本发布…`;
    const rebuild = await waitForRebuild();
    status.textContent = `新图集 ${rebuild.lastImage} 已发布，正在刷新…`;
    location.reload();
  } catch (error) {
    status.textContent = error.message;
    uploadSubmit.disabled = false;
  }
});

gallery.addEventListener("click", async (event) => {
  const button = event.target.closest("button.gallery-delete");
  if (!button) return;
  const iconId = button.dataset.iconId;
  if (!confirm(`确定永久删除图标 ${iconId}？此操作会删除服务端原图和 iconId 记录，无法恢复。`)) return;
  button.disabled = true;
  status.textContent = `正在永久删除 ${iconId}…`;
  try {
    const response = await fetch(`/api/icons/${encodeURIComponent(iconId)}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        spriteName: spriteNameInput.value.trim(),
        trimTransparent: trimTransparentInput.checked
      })
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.message);
    status.textContent = `${body.message}，等待新版本发布…`;
    if (body.rebuild.state !== "idle") await waitForRebuild();
    location.reload();
  } catch (error) {
    status.textContent = error.message;
    button.disabled = false;
  }
});

try {
  status.textContent = "正在加载 manifest 与单张图集…";
  const [manifest, recordsResponse] = await Promise.all([
    atlas.load(),
    fetch("/api/icons", { cache: "no-store" })
  ]);
  if (recordsResponse.ok) {
    for (const record of await recordsResponse.json()) existingIds.add(record.id);
  }
  spriteNameInput.value = manifest.name ?? "sprite";
  trimTransparentInput.checked = manifest.trimTransparent ?? false;
  renderOutputPaths(manifest);
  const iconIds = Object.keys(manifest.icons);
  renderGallery(iconIds);
  /* standalone:openlayers:start */
  if (document.querySelector("#map") && globalThis.ol) await renderMap(iconIds);
  /* standalone:openlayers:end */
  requestAnimationFrame(() => showMetrics(iconIds.length));
  status.textContent = document.querySelector("#map")
    ? `PNG 图集 ${manifest.name} · ${manifest.version} 已加载，可同时用于地图和普通页面。`
    : `PNG 图集 ${manifest.name} · ${manifest.version} 已加载。`;
} catch (error) {
  status.textContent = `${error.message}。请先把原图放入项目目录并运行 sprite-generator init/build，或直接上传第一张图标。`;
}

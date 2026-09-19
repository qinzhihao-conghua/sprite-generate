import { randomUUID } from "node:crypto";
import { access, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { AppError } from "./errors.js";
import { normalizeIcon } from "./normalize.js";
import { ensureDirectory, readJson, sha256 } from "./storage.js";
import type { IconRecord, SpriteConfig, SpriteManifest } from "./types.js";

interface PublishResult {
  manifest: SpriteManifest;
  manifestUrl: string;
  reused: boolean;
}

export interface CurrentPointer {
  version: string;
  buildNumber: number;
  contentHash: string;
  spriteName: string;
  image: string;
  manifest: string;
  stylesheet: string;
  trimTransparent: boolean;
}

const CSS_FORMAT_VERSION = 2;

/** 为任意合法 iconId 生成无需 CSS 转义的属性选择器。 */
function iconClassSelector(iconId: string): string {
  return `[class~="${iconId}"]`;
}

/** 根据 manifest 坐标生成可直接按 iconId 使用的 CSS 雪碧图规则。 */
function createStylesheet(
  records: IconRecord[],
  icons: SpriteManifest["icons"],
  imageUrl: string,
  atlasWidth: number,
  atlasHeight: number
): string {
  const selectors = records.map((record) => iconClassSelector(record.id)).join(",\n");
  const rules = records.map((record) => {
    const icon = icons[record.id]!;
    const scaleX = icon.displayWidth / icon.width;
    const scaleY = icon.displayHeight / icon.height;
    return `${iconClassSelector(record.id)} {\n` +
      `  width: ${icon.displayWidth}px;\n` +
      `  height: ${icon.displayHeight}px;\n` +
      `  flex: 0 0 ${icon.displayWidth}px;\n` +
      `  background-size: ${atlasWidth * scaleX}px ${atlasHeight * scaleY}px;\n` +
      `  background-position: ${-icon.x * scaleX}px ${-icon.y * scaleY}px;\n` +
      `}`;
  });
  return `/* Generated file. Use the iconId directly: class="<iconId>" */\n` +
    `${selectors} {\n` +
    `  display: inline-block;\n` +
    `  background-image: url("${imageUrl}");\n` +
    `  background-repeat: no-repeat;\n` +
    `}\n\n` +
    `${rules.join("\n\n")}\n`;
}

export class AtlasPublisher {
  private publishing: Promise<PublishResult> | undefined;

  /** 创建使用指定项目配置的图集发布器。 */
  constructor(private readonly config: SpriteConfig) {}

  /** 发布当前图标集合，并复用正在进行中的同一发布任务。 */
  publish(
    records: IconRecord[],
    spriteName = "sprite",
    trimTransparent = false
  ): Promise<PublishResult> {
    if (this.publishing) return this.publishing;
    this.publishing = this.build(records, spriteName, trimTransparent).finally(() => {
      this.publishing = undefined;
    });
    return this.publishing;
  }

  /** 标准化全部启用图标，生成 PNG、manifest、CSS 并原子发布。 */
  private async build(
    records: IconRecord[],
    spriteName: string,
    trimTransparent: boolean
  ): Promise<PublishResult> {
    const enabled = records.filter((record) => record.enabled).sort((a, b) => a.id.localeCompare(b.id));
    if (enabled.length === 0) throw new AppError("没有可生成图集的图标", 409, "NO_ICONS");
    if (enabled.length > this.config.maxIcons) {
      throw new AppError(`单张图集最多支持 ${this.config.maxIcons} 个图标`, 409, "TOO_MANY_ICONS");
    }

    const normalized = await Promise.all(
      enabled.map(async (record) => ({
        record,
        buffer: await normalizeIcon(
          await readFile(path.join(this.config.originalsDir, record.sourceFile)),
          this.config,
          record.padding ?? this.config.padding,
          trimTransparent
        )
      }))
    );

    const columns = Math.min(this.config.columns, enabled.length);
    const rows = Math.ceil(enabled.length / columns);
    const width = columns * this.config.cellSize;
    const height = rows * this.config.cellSize;
    const atlas = await sharp({
      create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
    })
      .composite(
        normalized.map((item, index) => ({
          input: item.buffer,
          left: (index % columns) * this.config.cellSize,
          top: Math.floor(index / columns) * this.config.cellSize
        }))
      )
      .png({ compressionLevel: 9, adaptiveFiltering: true, palette: false })
      .toBuffer();

    const manifestMetadata = enabled.map((record, index) => ({
      id: record.id,
      contentHash: record.contentHash,
      displayWidth: record.displayWidth,
      displayHeight: record.displayHeight,
      anchor: record.anchor,
      padding: record.padding ?? this.config.padding,
      index
    }));
    const contentHash = sha256(
      Buffer.concat([
        atlas,
        Buffer.from(JSON.stringify({ trimTransparent, cssFormatVersion: CSS_FORMAT_VERSION, icons: manifestMetadata }))
      ])
    );
    const currentDir = path.join(this.config.generatedDir, "current");
    const pointerFile = path.join(currentDir, "current.json");
    const legacyPointerFile = path.join(this.config.generatedDir, "current.json");
    const current = await readJson<CurrentPointer | null>(
      pointerFile,
      await readJson<CurrentPointer | null>(legacyPointerFile, null)
    );
    if (
      current?.contentHash === contentHash &&
      current.spriteName === spriteName &&
      current.trimTransparent === trimTransparent &&
      current.stylesheet?.startsWith("/generated/current/")
    ) {
      const manifestFile = path.join(currentDir, path.basename(current.manifest));
      const stylesheetFile = path.join(currentDir, path.basename(current.stylesheet));
      await access(stylesheetFile);
      const manifest = JSON.parse(await readFile(manifestFile, "utf8")) as SpriteManifest;
      return { manifest, manifestUrl: current.manifest, reused: true };
    }

    const buildNumber = (current?.buildNumber ?? 0) + 1;
    const versionLabel = `v${String(buildNumber).padStart(3, "0")}`;
    const shortHash = contentHash.slice(0, 8);
    const version = `${versionLabel}-${shortHash}`;
    const imageName = `${spriteName}.png`;
    const manifestName = `${spriteName}.manifest.json`;
    const stylesheetName = `${spriteName}.css`;
    const manifestUrl = `/generated/current/${manifestName}`;
    const imageUrl = `/generated/current/${imageName}`;
    const stylesheetUrl = `/generated/current/${stylesheetName}`;

    const icons = Object.fromEntries(
      enabled.map((record, index) => [
        record.id,
        {
          x: (index % columns) * this.config.cellSize,
          y: Math.floor(index / columns) * this.config.cellSize,
          width: this.config.cellSize,
          height: this.config.cellSize,
          displayWidth: record.displayWidth,
          displayHeight: record.displayHeight,
          anchor: record.anchor,
          padding: record.padding ?? this.config.padding
        }
      ])
    );
    const manifest: SpriteManifest = {
      name: spriteName,
      version,
      buildNumber,
      contentHash,
      image: imageUrl,
      manifest: manifestUrl,
      stylesheet: stylesheetUrl,
      trimTransparent,
      pixelRatio: this.config.pixelRatio,
      width,
      height,
      cellSize: this.config.cellSize,
      usages: ["map", "page"],
      icons
    };
    const stylesheet = createStylesheet(enabled, icons, imageUrl, width, height);

    const stagingDir = path.join(this.config.generatedDir, `.staging-${randomUUID()}`);
    const imageFile = path.join(stagingDir, imageName);
    const manifestFile = path.join(stagingDir, manifestName);
    const stylesheetFile = path.join(stagingDir, stylesheetName);
    const stagedPointerFile = path.join(stagingDir, "current.json");
    try {
      await ensureDirectory(stagingDir);
      await writeFile(imageFile, atlas);
      await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
      await writeFile(stylesheetFile, stylesheet);
      await writeFile(
        stagedPointerFile,
        `${JSON.stringify({
          version,
          buildNumber,
          contentHash,
          spriteName,
          trimTransparent,
          image: imageUrl,
          manifest: manifestUrl,
          stylesheet: stylesheetUrl
        })}\n`
      );
      await access(imageFile);
      await access(manifestFile);
      await access(stylesheetFile);
      await this.replaceCurrentDirectory(currentDir, stagingDir);
      await rm(legacyPointerFile, { force: true });
      await rm(path.join(this.config.generatedDir, "versions"), { recursive: true, force: true });
    } catch (error) {
      await rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
    return { manifest, manifestUrl, reused: false };
  }

  /** 用暂存目录替换 current，并在替换失败时恢复上一份产物。 */
  private async replaceCurrentDirectory(currentDir: string, stagingDir: string): Promise<void> {
    const replacedDir = path.join(this.config.generatedDir, `.replaced-${randomUUID()}`);
    let hadCurrent = false;
    try {
      await rename(currentDir, replacedDir);
      hadCurrent = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    try {
      await rename(stagingDir, currentDir);
    } catch (error) {
      if (hadCurrent) await rename(replacedDir, currentDir).catch(() => undefined);
      throw error;
    }
    if (hadCurrent) await rm(replacedDir, { recursive: true, force: true });
  }
}

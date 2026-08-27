import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { AppError } from "./errors.js";
import { normalizeIcon } from "./normalize.js";
import { atomicWriteFile, ensureDirectory, readJson, sha256 } from "./storage.js";
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
  trimTransparent: boolean;
}

export class AtlasPublisher {
  private publishing: Promise<PublishResult> | undefined;

  constructor(private readonly config: SpriteConfig) {}

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
          await readFile(path.join(this.config.dataDir, "originals", record.sourceFile)),
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
      Buffer.concat([atlas, Buffer.from(JSON.stringify({ trimTransparent, icons: manifestMetadata }))])
    );
    const pointerFile = path.join(this.config.generatedDir, "current.json");
    const current = await readJson<CurrentPointer | null>(pointerFile, null);
    if (
      current?.contentHash === contentHash &&
      current.spriteName === spriteName &&
      current.trimTransparent === trimTransparent
    ) {
      const manifestFile = path.join(
        this.config.generatedDir,
        "versions",
        current.version,
        path.basename(current.manifest)
      );
      const manifest = JSON.parse(await readFile(manifestFile, "utf8")) as SpriteManifest;
      return { manifest, manifestUrl: current.manifest, reused: true };
    }

    const buildNumber = (current?.buildNumber ?? 0) + 1;
    const versionLabel = `v${String(buildNumber).padStart(3, "0")}`;
    const shortHash = contentHash.slice(0, 8);
    const version = `${versionLabel}-${shortHash}`;
    const imageName = `${spriteName}.${versionLabel}.${shortHash}.png`;
    const manifestName = `${spriteName}.${versionLabel}.manifest.json`;
    const versionDir = path.join(this.config.generatedDir, "versions", version);
    const imageFile = path.join(versionDir, imageName);
    const manifestFile = path.join(versionDir, manifestName);
    const manifestUrl = `/generated/versions/${version}/${manifestName}`;
    const imageUrl = `/generated/versions/${version}/${imageName}`;

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
      trimTransparent,
      pixelRatio: this.config.pixelRatio,
      width,
      height,
      cellSize: this.config.cellSize,
      usages: ["map", "page"],
      icons
    };

    let reused = true;
    try {
      await access(imageFile);
      await access(manifestFile);
    } catch {
      reused = false;
      await ensureDirectory(versionDir);
      await writeFile(imageFile, atlas, { flag: "wx" }).catch(async (error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error;
      });
      await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" }).catch(
        async (error: NodeJS.ErrnoException) => {
          if (error.code !== "EEXIST") throw error;
        }
      );
      await access(imageFile);
      await access(manifestFile);
    }

    await atomicWriteFile(
      pointerFile,
      `${JSON.stringify({
        version,
        buildNumber,
        contentHash,
        spriteName,
        trimTransparent,
        image: imageUrl,
        manifest: manifestUrl
      })}\n`
    );
    return { manifest, manifestUrl, reused };
  }
}

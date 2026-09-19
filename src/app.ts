import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type ErrorRequestHandler, type RequestHandler } from "express";
import multer from "multer";
import { AtlasPublisher, type CurrentPointer } from "./atlas.js";
import { saveProjectBuildOptions } from "./config.js";
import { AppError } from "./errors.js";
import { RebuildQueue } from "./queue.js";
import { IconStore, readJson, sha256 } from "./storage.js";
import type { IconRecord, SpriteConfig, SpriteManifest } from "./types.js";
import {
  inspectImage,
  parseAnchor,
  parseDisplaySize,
  parsePadding,
  validateIconId,
  validateSpriteName
} from "./validation.js";

interface UploadMetadata {
  iconId?: unknown;
  name?: unknown;
  anchorType?: unknown;
  anchorX?: unknown;
  anchorY?: unknown;
  displayWidth?: unknown;
  displayHeight?: unknown;
  padding?: unknown;
}

/** 将 Promise 路由包装成 Express 可捕获异常的请求处理器。 */
function asyncRoute(handler: RequestHandler): RequestHandler {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

/** 将表单或 JSON 中的常见真值转换为布尔值。 */
function parseBoolean(value: unknown): boolean {
  return value === true || value === "true" || value === "1" || value === "on";
}

/** 创建 API、生成物和管理页面共用的 Express 应用。 */
export function createApp(config: SpriteConfig) {
  const app = express();
  const store = new IconStore(config.originalsDir, config.recordsFile);
  const publisher = new AtlasPublisher(config);
  const queue = new RebuildQueue(store, publisher);
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.maxUploadBytes, files: config.maxBatchFiles, fields: 20 }
  });

  /** 合并本次请求、当前构建指针和项目默认值中的构建选项。 */
  async function currentBuildOptions(body: Record<string, unknown> | undefined) {
    const current = await readJson<CurrentPointer | null>(
      path.join(config.generatedDir, "current", "current.json"),
      null
    );
    return {
      spriteName:
        body?.spriteName === undefined
          ? (current?.spriteName ?? config.spriteName)
          : validateSpriteName(body.spriteName),
      trimTransparent:
        body?.trimTransparent === undefined
          ? (current?.trimTransparent ?? config.trimTransparent)
          : parseBoolean(body.trimTransparent)
    };
  }

  /** 校验上传文件与元数据，并构造等待持久化的图标记录。 */
  async function prepareIcon(
    file: Express.Multer.File,
    metadata: UploadMetadata,
    existingById: Map<string, IconRecord>
  ): Promise<{ record: IconRecord; source: Buffer; action: "added" | "replaced" }> {
    const iconId = validateIconId(metadata.iconId);
    const inspected = await inspectImage(file.buffer, file.originalname, config);
    const { anchorType, anchor } = parseAnchor(metadata.anchorType, metadata.anchorX, metadata.anchorY);
    const displayWidth = parseDisplaySize(metadata.displayWidth);
    const displayHeight = parseDisplaySize(metadata.displayHeight);
    const padding = parsePadding(metadata.padding, config.padding);
    const contentHash = sha256(inspected.source);
    const now = new Date().toISOString();
    const existing = existingById.get(iconId);
    return {
      action: existing ? "replaced" : "added",
      source: inspected.source,
      record: {
        id: iconId,
        name: String(metadata.name ?? iconId).trim().slice(0, 100) || iconId,
        sourceFile: `${iconId}.${inspected.extension}`,
        sourceFormat: inspected.format,
        anchorType,
        anchor,
        displayWidth,
        displayHeight,
        padding,
        enabled: true,
        contentHash,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now
      }
    };
  }

  app.disable("x-powered-by");
  app.use(express.json({ limit: "64kb" }));

  app.get("/api/health", (_request, response) => {
    response.json({ ok: true, queue: queue.getStatus() });
  });

  app.get(
    "/api/icons",
    asyncRoute(async (_request, response) => {
      response.set("Cache-Control", "no-store").json(await store.list());
    })
  );

  app.post(
    "/api/icons",
    upload.single("file"),
    asyncRoute(async (request, response) => {
      if (!request.file) throw new AppError("缺少 file 上传字段", 400, "FILE_REQUIRED");
      const { spriteName, trimTransparent } = await currentBuildOptions(request.body);
      const existingById = new Map((await store.list()).map((item) => [item.id, item]));
      const prepared = await prepareIcon(request.file, request.body, existingById);
      await store.save(prepared.record, prepared.source);
      await saveProjectBuildOptions(config, spriteName, trimTransparent);
      queue.enqueue(spriteName, trimTransparent);
      response.status(prepared.action === "replaced" ? 200 : 201).json({
        icon: prepared.record,
        action: prepared.action,
        spriteName,
        trimTransparent,
        rebuild: queue.getStatus(),
        message:
          prepared.action === "replaced" ? "图标已替换，图集正在后台重建" : "图标已追加，图集正在后台重建"
      });
    })
  );

  app.post(
    "/api/icons/batch",
    upload.array("files", config.maxBatchFiles),
    asyncRoute(async (request, response) => {
      const files = Array.isArray(request.files) ? request.files : [];
      if (files.length === 0) throw new AppError("至少选择一张图片", 400, "FILES_REQUIRED");
      const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
      if (totalBytes > config.maxBatchBytes) {
        throw new AppError("批量文件总大小超过 20 MiB", 413, "BATCH_TOO_LARGE");
      }

      let metadata: UploadMetadata[];
      try {
        metadata = JSON.parse(String(request.body.metadata ?? "[]")) as UploadMetadata[];
      } catch {
        throw new AppError("metadata 必须是合法 JSON", 400, "INVALID_METADATA");
      }
      if (!Array.isArray(metadata) || metadata.length !== files.length) {
        throw new AppError("每张图片都必须有一条对应设置", 400, "METADATA_MISMATCH");
      }
      const ids = metadata.map((item) => validateIconId(item.iconId));
      if (new Set(ids).size !== ids.length) {
        throw new AppError("同一批次中 iconId 不能重复", 409, "DUPLICATE_ICON_ID");
      }

      const { spriteName, trimTransparent } = await currentBuildOptions(request.body);
      const existingById = new Map((await store.list()).map((item) => [item.id, item]));
      const prepared = await Promise.all(
        files.map((file, index) => prepareIcon(file, metadata[index]!, existingById))
      );
      await store.saveBatch(prepared.map(({ record, source }) => ({ record, source })));
      await saveProjectBuildOptions(config, spriteName, trimTransparent);
      queue.enqueue(spriteName, trimTransparent);

      const added = prepared.filter((item) => item.action === "added").length;
      const replaced = prepared.length - added;
      response.status(added > 0 ? 201 : 200).json({
        results: prepared.map((item) => ({ icon: item.record, action: item.action })),
        summary: { total: prepared.length, added, replaced },
        spriteName,
        trimTransparent,
        rebuild: queue.getStatus(),
        message: `已处理 ${prepared.length} 张图片：追加 ${added} 张，替换 ${replaced} 张，图集正在后台重建`
      });
    })
  );

  app.delete(
    "/api/icons/:iconId",
    asyncRoute(async (request, response) => {
      const iconId = validateIconId(request.params.iconId);
      const records = await store.list();
      const existing = records.find((record) => record.id === iconId);
      if (!existing) throw new AppError("图标不存在", 404, "ICON_NOT_FOUND");

      if (existing.enabled && records.filter((record) => record.enabled).length === 1) {
        throw new AppError("图集中至少需要保留一个启用图标", 409, "LAST_ENABLED_ICON");
      }

      const options = await currentBuildOptions(request.body);
      const removed = await store.remove(iconId);
      if (!removed) throw new AppError("图标不存在", 404, "ICON_NOT_FOUND");
      if (removed.enabled) {
        await saveProjectBuildOptions(config, options.spriteName, options.trimTransparent);
        queue.enqueue(options.spriteName, options.trimTransparent);
      }

      response.status(removed.enabled ? 202 : 200).json({
        icon: removed,
        action: "deleted",
        rebuild: queue.getStatus(),
        message: removed.enabled
          ? `图标 ${iconId} 已物理删除，正在发布新版本`
          : `图标 ${iconId} 已物理删除`
      });
    })
  );

  app.post("/api/icons/rebuild", asyncRoute(async (request, response) => {
    const { spriteName, trimTransparent } = await currentBuildOptions(request.body);
    await saveProjectBuildOptions(config, spriteName, trimTransparent);
    queue.enqueue(spriteName, trimTransparent);
    response.status(202).json({ message: "图集重建任务已进入队列", rebuild: queue.getStatus() });
  }));

  app.get("/api/icons/rebuild", (_request, response) => {
    response.set("Cache-Control", "no-store").json(queue.getStatus());
  });

  app.get(
    "/api/icons/manifest",
    asyncRoute(async (request, response) => {
      const current = await readJson<{ version: string; manifest: string } | null>(
        path.join(config.generatedDir, "current", "current.json"),
        null
      );
      if (!current) throw new AppError("图集尚未生成", 404, "MANIFEST_NOT_READY");
      const manifest = JSON.parse(
        await readFile(
          path.join(config.generatedDir, "current", path.basename(current.manifest)),
          "utf8"
        )
      ) as SpriteManifest;
      const etag = `\"${manifest.version}\"`;
      response.set({ "Cache-Control": "no-cache", ETag: etag });
      if (request.get("If-None-Match") === etag) {
        response.status(304).end();
        return;
      }
      response.json(manifest);
    })
  );

  app.get(
    "/api/icons/stylesheet",
    asyncRoute(async (request, response) => {
      const current = await readJson<{ version: string; stylesheet?: string } | null>(
        path.join(config.generatedDir, "current", "current.json"),
        null
      );
      if (!current?.stylesheet) throw new AppError("图标样式表尚未生成", 404, "STYLESHEET_NOT_READY");
      const etag = `\"${current.version}\"`;
      response.set({ "Cache-Control": "no-cache", ETag: etag, "Content-Type": "text/css; charset=utf-8" });
      if (request.get("If-None-Match") === etag) {
        response.status(304).end();
        return;
      }
      response.send(
        await readFile(
          path.join(config.generatedDir, "current", path.basename(current.stylesheet)),
          "utf8"
        )
      );
    })
  );

  app.use(
    "/generated",
    express.static(config.generatedDir, {
      fallthrough: false,
      setHeaders(response) {
        response.setHeader("Cache-Control", "no-cache");
      }
    })
  );
  if (process.env.SPRITE_STANDALONE !== "1") {
    const olPackageDir = path.dirname(fileURLToPath(import.meta.resolve("ol")));
    app.use("/vendor/ol", express.static(olPackageDir, { immutable: true, maxAge: "1y" }));
  }
  app.use(express.static(config.publicDir, { extensions: ["html"] }));

  app.use(((error, _request, response, _next) => {
    const multerError = error instanceof multer.MulterError;
    const httpStatus = Number((error as { status?: unknown })?.status);
    const statusCode = multerError
      ? 413
      : error instanceof AppError
        ? error.statusCode
        : Number.isInteger(httpStatus) && httpStatus >= 400 && httpStatus <= 599
          ? httpStatus
          : 500;
    const code = multerError
      ? error.code
      : error instanceof AppError
        ? error.code
        : statusCode === 404
          ? "NOT_FOUND"
          : "INTERNAL_ERROR";
    response.status(statusCode).json({
      error: code,
      message: statusCode === 500
        ? "服务器内部错误"
        : statusCode === 404
          ? "资源不存在"
          : error.message
    });
  }) satisfies ErrorRequestHandler);

  return { app, services: { store, publisher, queue } };
}

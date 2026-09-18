import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_PROJECT_CONFIG, PROJECT_CONFIG_FILE, loadProjectConfig } from "./config.js";
import { IconStore, ensureDirectory, sha256 } from "./storage.js";
import type { IconRecord, ProjectConfigFile } from "./types.js";
import { inspectImage, validateIconId, validateSpriteName } from "./validation.js";

const SUPPORTED_EXTENSIONS = new Set([".svg", ".png", ".jpg", ".jpeg", ".webp"]);
const LEGACY_HASHED_SOURCE = /^(.*)\.([a-f\d]{16})$/i;

export interface InitProjectOptions {
  sourceDir?: string;
  metadataFile?: string;
  outputDir?: string;
  spriteName?: string;
  trimTransparent?: boolean;
}

export interface InitProjectResult {
  configFile: string;
  sourceDir: string;
  metadataFile: string;
  outputDir: string;
  imported: number;
  added: number;
  updated: number;
}

function relativeProjectPath(value: string): string {
  return value.replaceAll("\\", "/");
}

export async function initializeProject(
  projectRoot = process.cwd(),
  options: InitProjectOptions = {}
): Promise<InitProjectResult> {
  const root = path.resolve(projectRoot);
  const configFile = path.join(root, PROJECT_CONFIG_FILE);
  let fileConfig: ProjectConfigFile;
  let configExists = true;
  try {
    fileConfig = JSON.parse(await readFile(configFile, "utf8")) as ProjectConfigFile;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new Error(`${PROJECT_CONFIG_FILE} 不是合法 JSON`);
    }
    configExists = false;
    fileConfig = {
      sourceDir: relativeProjectPath(options.sourceDir ?? DEFAULT_PROJECT_CONFIG.sourceDir),
      metadataFile: relativeProjectPath(options.metadataFile ?? DEFAULT_PROJECT_CONFIG.metadataFile),
      outputDir: relativeProjectPath(options.outputDir ?? DEFAULT_PROJECT_CONFIG.outputDir),
      spriteName: validateSpriteName(options.spriteName ?? DEFAULT_PROJECT_CONFIG.spriteName),
      trimTransparent: options.trimTransparent ?? DEFAULT_PROJECT_CONFIG.trimTransparent
    };
  }

  if (!configExists) {
    await ensureDirectory(root);
    await writeFile(configFile, `${JSON.stringify(fileConfig, null, 2)}\n`);
  }

  const config = await loadProjectConfig(root);
  await ensureDirectory(config.originalsDir);
  const store = new IconStore(config.originalsDir, config.recordsFile);
  const existingRecords = await store.list();
  const existingById = new Map(existingRecords.map((record) => [record.id, record]));
  const existingBySourceFile = new Map(
    existingRecords.map((record) => [record.sourceFile, record])
  );
  const files = (await readdir(config.originalsDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
  const sources = files.flatMap((sourceFile) => {
    const previous = existingBySourceFile.get(sourceFile);
    if (previous) return [{ sourceFile, id: validateIconId(previous.id) }];

    const stem = path.basename(sourceFile, path.extname(sourceFile));
    const legacy = LEGACY_HASHED_SOURCE.exec(stem);
    const legacyId = legacy?.[1];
    if (legacyId && existingById.has(legacyId)) {
      // Older versions stored sources as iconId.<content-hash>.<ext>. Keep the file
      // referenced by metadata and ignore superseded siblings without deleting them.
      return [];
    }
    return [{ sourceFile, id: validateIconId(stem) }];
  });

  if (new Set(sources.map((source) => source.id)).size !== sources.length) {
    throw new Error("原图目录中存在同名但扩展名不同的文件，无法生成唯一 iconId");
  }

  let added = 0;
  let updated = 0;
  const records: IconRecord[] = [];
  for (const { sourceFile, id } of sources) {
    const source = await readFile(path.join(config.originalsDir, sourceFile));
    const inspected = await inspectImage(source, sourceFile, config);
    const contentHash = sha256(inspected.source);
    const previous = existingById.get(id);
    const changed = !previous || previous.contentHash !== contentHash || previous.sourceFile !== sourceFile;
    const now = new Date().toISOString();
    if (previous) {
      if (changed) updated += 1;
    } else {
      added += 1;
    }
    records.push({
      id,
      name: previous?.name ?? id,
      sourceFile,
      sourceFormat: inspected.format,
      anchorType: previous?.anchorType ?? "center",
      anchor: previous?.anchor ?? [0.5, 0.5],
      displayWidth: previous?.displayWidth ?? 32,
      displayHeight: previous?.displayHeight ?? 32,
      padding: previous?.padding ?? config.padding,
      enabled: previous?.enabled ?? true,
      contentHash,
      createdAt: previous?.createdAt ?? now,
      updatedAt: changed ? now : previous.updatedAt
    });
  }
  await store.replaceAll(records);

  return {
    configFile,
    sourceDir: config.originalsDir,
    metadataFile: config.recordsFile,
    outputDir: config.generatedDir,
    imported: records.length,
    added,
    updated
  };
}

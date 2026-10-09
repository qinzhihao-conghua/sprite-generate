import { randomUUID } from "node:crypto";
import path from "node:path";
import { readFile, rename, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { ProjectConfigFile, SpriteConfig } from "./types.js";
import { validateSpriteName } from "./validation.js";

export const PROJECT_CONFIG_FILE = "sprite-generator.config.json";
export const DEFAULT_PROJECT_CONFIG: ProjectConfigFile = {
  sourceDir: "src/assets/icons",
  metadataFile: "src/assets/icons.metadata.json",
  outputDir: "output",
  spriteName: "sprite",
  trimTransparent: false
};

const bundledPublicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const configMutationQueues = new Map<string, Promise<void>>();

/** 将正整数字符串转换为数值；无效值回退到默认配置。 */
function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/** 合并默认值、环境变量和调用方覆盖项，生成完整运行配置。 */
export function createConfig(overrides: Partial<SpriteConfig> = {}): SpriteConfig {
  const projectRoot = path.resolve(overrides.projectRoot ?? process.cwd());
  const dataDir = path.resolve(overrides.dataDir ?? process.env.SPRITE_DATA_DIR ?? path.join(projectRoot, "data"));
  const originalsDir = path.resolve(
    overrides.originalsDir ?? process.env.SPRITE_SOURCE_DIR ?? path.join(dataDir, "originals")
  );
  const recordsFile = path.resolve(
    overrides.recordsFile ?? process.env.SPRITE_METADATA_FILE ?? path.join(dataDir, "icons.json")
  );
  const publicDir = path.resolve(overrides.publicDir ?? process.env.SPRITE_PUBLIC_DIR ?? bundledPublicDir);
  const generatedDir = path.resolve(
    overrides.generatedDir ?? process.env.SPRITE_GENERATED_DIR ?? path.join(projectRoot, "output")
  );

  return {
    projectRoot,
    dataDir,
    originalsDir,
    recordsFile,
    publicDir,
    generatedDir,
    /** 生成物的访问前缀，取 outputDir 目录名，如默认 output -> /output。 */
    publicUrlBase: `/${path.basename(generatedDir)}`,
    spriteName: overrides.spriteName ?? "sprite",
    trimTransparent: overrides.trimTransparent ?? false,
    cellSize: overrides.cellSize ?? 64,
    padding: overrides.padding ?? 6,
    pixelRatio: overrides.pixelRatio ?? 2,
    columns: overrides.columns ?? 16,
    maxIcons: overrides.maxIcons ?? 1000,
    maxUploadBytes:
      overrides.maxUploadBytes ?? positiveInteger(process.env.MAX_UPLOAD_BYTES, 2 * 1024 * 1024),
    maxInputPixels:
      overrides.maxInputPixels ?? positiveInteger(process.env.MAX_INPUT_PIXELS, 4096 * 4096),
    maxInputDimension:
      overrides.maxInputDimension ?? positiveInteger(process.env.MAX_INPUT_DIMENSION, 160),
    maxBatchFiles: overrides.maxBatchFiles ?? 100,
    maxBatchBytes: overrides.maxBatchBytes ?? 20 * 1024 * 1024
  };
}

/** 读取项目配置文件，并把其中的相对目录解析为绝对路径。 */
export async function loadProjectConfig(projectRoot = process.cwd()): Promise<SpriteConfig> {
  const root = path.resolve(projectRoot);
  const configFile = path.join(root, PROJECT_CONFIG_FILE);
  let project: ProjectConfigFile;
  try {
    project = JSON.parse(await readFile(configFile, "utf8")) as ProjectConfigFile;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`未找到 ${PROJECT_CONFIG_FILE}，请在业务项目根目录直接启动 Sprite Generator 服务`);
    }
    throw new Error(`${PROJECT_CONFIG_FILE} 不是合法 JSON`);
  }

  for (const key of ["sourceDir", "metadataFile", "outputDir"] as const) {
    if (typeof project[key] !== "string" || !project[key].trim()) {
      throw new Error(`${PROJECT_CONFIG_FILE} 缺少有效的 ${key}`);
    }
  }

  const dataDir = path.dirname(path.resolve(root, project.metadataFile));
  return createConfig({
    projectRoot: root,
    dataDir,
    originalsDir: path.resolve(root, project.sourceDir),
    recordsFile: path.resolve(root, project.metadataFile),
    generatedDir: path.resolve(root, project.outputDir),
    spriteName: validateSpriteName(project.spriteName),
    trimTransparent: project.trimTransparent === true
  });
}

/** 串行保存图集名称和裁边选项，避免并发请求覆盖配置临时文件。 */
export async function saveProjectBuildOptions(
  config: SpriteConfig,
  spriteName: string,
  trimTransparent: boolean
): Promise<void> {
  const configFile = path.join(config.projectRoot, PROJECT_CONFIG_FILE);
  const validatedName = validateSpriteName(spriteName);
  const previous = configMutationQueues.get(configFile) ?? Promise.resolve();
  const mutation = previous.then(async () => {
    config.spriteName = validatedName;
    config.trimTransparent = trimTransparent;
    let project: ProjectConfigFile;
    try {
      project = JSON.parse(await readFile(configFile, "utf8")) as ProjectConfigFile;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    project.spriteName = config.spriteName;
    project.trimTransparent = trimTransparent;
    const temporary = `${configFile}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(project, null, 2)}\n`);
    await rename(temporary, configFile);
  });
  const settled = mutation.then(() => undefined, () => undefined);
  configMutationQueues.set(configFile, settled);
  try {
    await mutation;
  } finally {
    if (configMutationQueues.get(configFile) === settled) configMutationQueues.delete(configFile);
  }
}

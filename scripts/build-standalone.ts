import { brotliCompress } from "node:zlib";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { constants as zlibConstants } from "node:zlib";

const compress = promisify(brotliCompress);
const projectRoot = process.cwd();
const compiledDir = path.join(projectRoot, ".build");
const distDir = path.join(projectRoot, "dist");
const outputFile = path.join(distDir, "sprite-generator.js");
const stageRoot = await mkdtemp(path.join(os.tmpdir(), "sprite-generator-build-"));
const OPENLAYERS_BLOCK = /\s*<!-- standalone:openlayers:start -->[\s\S]*?<!-- standalone:openlayers:end -->\s*/g;
const OPENLAYERS_SCRIPT_BLOCK = /\s*\/\* standalone:openlayers:start \*\/[\s\S]*?\/\* standalone:openlayers:end \*\/\s*/g;

interface SourcePackage {
  name: string;
  version: string;
  engines?: Record<string, string>;
  dependencies: Record<string, string>;
}

/** 在指定目录执行外部命令，并将非零退出码转换为异常。 */
function run(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const executable = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : command;
    const executableArgs =
      process.platform === "win32" ? ["/d", "/s", "/c", [command, ...args].join(" ")] : args;
    const child = spawn(executable, executableArgs, {
      cwd,
      stdio: "inherit"
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} 执行失败，退出码 ${code ?? "unknown"}`));
    });
  });
}

/** 递归收集运行目录中的普通文件，生成稳定的归档输入顺序。 */
async function collectFiles(root: string): Promise<Array<{ name: string; data: Buffer }>> {
  const files: Array<{ name: string; data: Buffer }> = [];

  /** 深度遍历当前目录，并跳过不需要进入运行包的 npm 辅助文件。 */
  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.name === ".bin" || entry.name === "package-lock.json") continue;
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      if (entry.isDirectory()) {
        await visit(absolute);
      } else if (entry.isFile()) {
        files.push({ name: relative, data: await readFile(absolute) });
      } else if (entry.isSymbolicLink()) {
        const target = await lstat(absolute);
        if (target.isFile()) files.push({ name: relative, data: await readFile(absolute) });
      }
    }
  }

  await visit(root);
  return files;
}

/** 将文件列表编码为轻量的 SGR1 二进制归档。 */
function createArchive(files: Array<{ name: string; data: Buffer }>): Buffer {
  const chunks: Buffer[] = [];
  const header = Buffer.allocUnsafe(8);
  header.write("SGR1", 0, "ascii");
  header.writeUInt32LE(files.length, 4);
  chunks.push(header);

  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const fileHeader = Buffer.allocUnsafe(8);
    fileHeader.writeUInt32LE(name.length, 0);
    fileHeader.writeUInt32LE(file.data.length, 4);
    chunks.push(fileHeader, name, file.data);
  }
  return Buffer.concat(chunks);
}

/** 生成负责校验平台、释放缓存运行时并启动服务的单文件入口。 */
function createLauncher(payload: string, hash: string, platform: string, arch: string): string {
  return `/* Sprite Generator self-contained runtime. Built for ${platform}-${arch}. */
void (async () => {
  const { brotliDecompressSync } = await import("node:zlib");
  const { mkdir, readFile, rename, rm, writeFile } = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const { pathToFileURL } = await import("node:url");
  const expectedPlatform = ${JSON.stringify(platform)};
  const expectedArch = ${JSON.stringify(arch)};
  if (process.platform !== expectedPlatform || process.arch !== expectedArch) {
    throw new Error(
      \`此入口为 \${expectedPlatform}-\${expectedArch} 构建，当前环境是 \${process.platform}-\${process.arch}；请在目标平台重新执行 pnpm build。\`
    );
  }

  const hash = ${JSON.stringify(hash)};
  process.env.SPRITE_STANDALONE = "1";
  const runtimeDir = path.join(os.tmpdir(), \`sprite-generator-runtime-\${expectedPlatform}-\${expectedArch}-\${hash}\`);
  const marker = path.join(runtimeDir, ".complete");
  let ready = false;
  try {
    ready = (await readFile(marker, "utf8")) === hash;
  } catch {}

  if (!ready) {
    const temporary = \`\${runtimeDir}.\${process.pid}.\${Date.now()}\`;
    await mkdir(temporary, { recursive: true });
    try {
      const archive = brotliDecompressSync(Buffer.from(${JSON.stringify(payload)}, "base64"));
      if (archive.subarray(0, 4).toString("ascii") !== "SGR1") throw new Error("运行包格式无效");
      const count = archive.readUInt32LE(4);
      let offset = 8;
      for (let index = 0; index < count; index += 1) {
        const nameLength = archive.readUInt32LE(offset);
        const dataLength = archive.readUInt32LE(offset + 4);
        offset += 8;
        const name = archive.subarray(offset, offset + nameLength).toString("utf8");
        offset += nameLength;
        const destination = path.resolve(temporary, name);
        const rootWithSeparator = path.resolve(temporary) + path.sep;
        if (!destination.startsWith(rootWithSeparator)) throw new Error("运行包包含非法路径");
        await mkdir(path.dirname(destination), { recursive: true });
        await writeFile(destination, archive.subarray(offset, offset + dataLength));
        offset += dataLength;
      }
      await writeFile(path.join(temporary, ".complete"), hash, "utf8");
      try {
        await rename(temporary, runtimeDir);
      } catch (error) {
        try {
          if ((await readFile(marker, "utf8")) !== hash) throw error;
        } finally {
          await rm(temporary, { recursive: true, force: true });
        }
      }
    } catch (error) {
      await rm(temporary, { recursive: true, force: true });
      throw error;
    }
  }

  await import(pathToFileURL(path.join(runtimeDir, "dist", "server.js")).href);
})().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
`;
}

try {
  const sourcePackage = JSON.parse(
    await readFile(path.join(projectRoot, "package.json"), "utf8")
  ) as SourcePackage;
  const runtimePackage = {
    name: `${sourcePackage.name}-runtime`,
    version: sourcePackage.version,
    private: true,
    type: "module",
    main: "dist/server.js",
    engines: sourcePackage.engines,
    dependencies: Object.fromEntries(
      Object.entries(sourcePackage.dependencies).filter(([name]) => name !== "ol")
    )
  };

  const standaloneIndex = (await readFile(path.join(projectRoot, "public", "index.html"), "utf8"))
    .replace(OPENLAYERS_BLOCK, "\n");
  const standaloneApp = (await readFile(path.join(projectRoot, "public", "app.js"), "utf8"))
    .replace(OPENLAYERS_SCRIPT_BLOCK, "\n");

  await Promise.all([
    cp(compiledDir, path.join(stageRoot, "dist"), { recursive: true }),
    cp(path.join(projectRoot, "public"), path.join(stageRoot, "public"), {
      recursive: true,
      filter: (source) =>
        path.basename(source) !== "generated" && path.basename(source) !== "openlayers-adapter.js"
    }),
    writeFile(path.join(stageRoot, "package.json"), `${JSON.stringify(runtimePackage, null, 2)}\n`)
  ]);
  await Promise.all([
    writeFile(path.join(stageRoot, "public", "index.html"), standaloneIndex),
    writeFile(path.join(stageRoot, "public", "app.js"), standaloneApp)
  ]);
  await run("npm", ["install", "--omit=dev", "--no-audit", "--no-fund"], stageRoot);

  const files = await collectFiles(stageRoot);
  const archive = createArchive(files);
  const compressed = await compress(archive, {
    params: {
      [zlibConstants.BROTLI_PARAM_QUALITY]: 9
    }
  });
  const hash = createHash("sha256").update(compressed).digest("hex").slice(0, 16);
  await mkdir(distDir, { recursive: true });
  await writeFile(
    outputFile,
    createLauncher(compressed.toString("base64"), hash, process.platform, process.arch)
  );
  console.log(
    `自包含入口已生成：${path.relative(projectRoot, outputFile)} (${(compressed.length / 1024 / 1024).toFixed(1)} MiB，${process.platform}-${process.arch})`
  );
} finally {
  await Promise.all([
    rm(stageRoot, { recursive: true, force: true }),
    rm(compiledDir, { recursive: true, force: true })
  ]);
}

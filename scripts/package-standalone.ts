import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const outputDir = path.join(process.cwd(), "packages", "sprite-generator");
const runtimeDir = path.join(outputDir, "sprite-generator-runtime");
await rm(path.join(process.cwd(), "packages"), { recursive: true, force: true });
await mkdir(runtimeDir, { recursive: true });
await Promise.all([
  cp(path.join(process.cwd(), "dist"), path.join(runtimeDir, "dist"), { recursive: true }),
  cp(path.join(process.cwd(), "public"), path.join(runtimeDir, "public"), {
    recursive: true,
    filter: (source) => path.basename(source) !== "generated"
  })
]);

const sourcePackage = JSON.parse(
  await readFile(path.join(process.cwd(), "package.json"), "utf8")
) as { name: string; version: string; dependencies: Record<string, string> };
await writeFile(
  path.join(runtimeDir, "package.json"),
  `${JSON.stringify({
    name: `${sourcePackage.name}-runtime`,
    version: sourcePackage.version,
    private: true,
    type: "module",
    main: "dist/server.js",
    dependencies: sourcePackage.dependencies
  }, null, 2)}\n`
);
await writeFile(
  path.join(outputDir, "sprite-generator.js"),
  'import "./sprite-generator-runtime/dist/server.js";\n'
);
await writeFile(
  path.join(outputDir, "使用说明.txt"),
  [
    "把 sprite-generator.js 和 sprite-generator-runtime 文件夹一起复制到业务项目根目录。",
    "在业务项目根目录执行：node sprite-generator.js",
    "浏览器访问：http://127.0.0.1:3000",
    "维护完成后按 Ctrl+C 关闭服务。",
    ""
  ].join("\n")
);

import type { Server } from "node:http";
import { createApp } from "./app.js";
import { loadProjectConfig } from "./config.js";
import { initializeProject } from "./project.js";

export interface StartProjectServerOptions {
  projectRoot?: string;
  host?: string;
  port?: number;
}

export async function prepareProject(projectRoot = process.cwd()) {
  const initialized = await initializeProject(projectRoot);
  const config = await loadProjectConfig(projectRoot);
  const application = createApp(config);
  const records = await application.services.store.list();
  if (records.length > 0) {
    await application.services.publisher.publish(
      records,
      config.spriteName,
      config.trimTransparent
    );
  }
  return { ...application, config, initialized, records };
}

export async function startProjectServer(
  options: StartProjectServerOptions = {}
): Promise<Server> {
  const projectRoot = options.projectRoot ?? process.env.SPRITE_PROJECT_ROOT ?? process.cwd();
  const host = options.host ?? process.env.HOST ?? "127.0.0.1";
  const port = options.port ?? Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT 必须是 1～65535 之间的整数");
  }

  const prepared = await prepareProject(projectRoot);
  return await new Promise<Server>((resolve, reject) => {
    const server = prepared.app.listen(port, host, () => {
      console.log(`Sprite Generator 已启动：http://${host}:${port}`);
      console.log(`配置基准目录：${prepared.config.projectRoot}`);
      console.log(`原图目录（sourceDir）：${prepared.config.originalsDir}`);
      console.log(`元数据文件（metadataFile）：${prepared.config.recordsFile}`);
      console.log(`输出目录（outputDir）：${prepared.config.generatedDir}`);
      console.log(`已读取 ${prepared.records.length} 张原图；完成维护后可按 Ctrl+C 关闭。`);
      resolve(server);
    });
    server.once("error", reject);
  });
}

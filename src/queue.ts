import type { SpriteManifest } from "./types.js";
import { AtlasPublisher } from "./atlas.js";
import { IconStore } from "./storage.js";

export interface QueueStatus {
  state: "idle" | "queued" | "building" | "failed";
  lastVersion?: string;
  lastImage?: string;
  lastManifest?: string;
  lastStylesheet?: string;
  spriteName?: string;
  trimTransparent?: boolean;
  lastError?: string;
  updatedAt: string;
}

export class RebuildQueue {
  private pending = false;
  private pendingSpriteName = "sprite";
  private pendingTrimTransparent = false;
  private worker: Promise<void> | undefined;
  private status: QueueStatus = { state: "idle", updatedAt: new Date().toISOString() };

  /** 创建绑定图标仓库与图集发布器的单进程重建队列。 */
  constructor(
    private readonly store: IconStore,
    private readonly publisher: AtlasPublisher
  ) {}

  /** 合并连续请求，并使用最后一次提交的全局构建选项重建。 */
  enqueue(spriteName = "sprite", trimTransparent = false): void {
    this.pending = true;
    this.pendingSpriteName = spriteName;
    this.pendingTrimTransparent = trimTransparent;
    this.status = { ...this.status, state: "queued", updatedAt: new Date().toISOString() };
    if (!this.worker) {
      this.worker = this.run().finally(() => {
        this.worker = undefined;
      });
    }
  }

  /** 返回当前队列状态的只读副本。 */
  getStatus(): QueueStatus {
    return { ...this.status };
  }

  /** 等待当前工作器处理完所有合并后的重建任务。 */
  async waitForIdle(): Promise<QueueStatus> {
    await this.worker;
    return this.getStatus();
  }

  /** 循环消费待处理标记，并更新成功或失败状态。 */
  private async run(): Promise<void> {
    while (this.pending) {
      this.pending = false;
      const spriteName = this.pendingSpriteName;
      const trimTransparent = this.pendingTrimTransparent;
      this.status = {
        ...this.status,
        state: "building",
        spriteName,
        trimTransparent,
        updatedAt: new Date().toISOString()
      };
      try {
        const result = await this.publisher.publish(
          await this.store.list(),
          spriteName,
          trimTransparent
        );
        this.status = {
          state: "idle",
          lastVersion: result.manifest.version,
          lastImage: result.manifest.image,
          lastManifest: result.manifest.manifest,
          lastStylesheet: result.manifest.stylesheet,
          spriteName,
          trimTransparent,
          updatedAt: new Date().toISOString()
        };
      } catch (error) {
        this.status = {
          ...this.status,
          state: "failed",
          lastError: error instanceof Error ? error.message : String(error),
          updatedAt: new Date().toISOString()
        };
      }
    }
  }
}

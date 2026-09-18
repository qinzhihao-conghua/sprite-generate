import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { IconRecord } from "./types.js";

export async function ensureDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
}

export async function atomicWriteFile(target: string, data: string | Buffer): Promise<void> {
  await ensureDirectory(path.dirname(target));
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, data);
  await rename(temporary, target);
}

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  }
}

export function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export class IconStore {
  readonly originalsDir: string;
  readonly recordsFile: string;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(originalsDirOrDataDir: string, recordsFile?: string) {
    this.originalsDir = recordsFile ? originalsDirOrDataDir : path.join(originalsDirOrDataDir, "originals");
    this.recordsFile = recordsFile ?? path.join(originalsDirOrDataDir, "icons.json");
  }

  async list(): Promise<IconRecord[]> {
    const records = await readJson<IconRecord[]>(this.recordsFile, []);
    return records.sort((left, right) => left.id.localeCompare(right.id));
  }

  async save(record: IconRecord, source: Buffer): Promise<void> {
    await this.saveBatch([{ record, source }]);
  }

  async saveBatch(items: Array<{ record: IconRecord; source: Buffer }>): Promise<void> {
    return this.withMutationLock(async () => this.saveBatchUnlocked(items));
  }

  private async saveBatchUnlocked(items: Array<{ record: IconRecord; source: Buffer }>): Promise<void> {
    await ensureDirectory(this.originalsDir);
    const records = await this.list();
    const staleFiles = new Set<string>();
    for (const { record } of items) {
      const existing = records.find((item) => item.id === record.id);
      if (existing && existing.sourceFile !== record.sourceFile) staleFiles.add(existing.sourceFile);
    }
    await Promise.all(
      items.map(({ record, source }) =>
        atomicWriteFile(path.join(this.originalsDir, record.sourceFile), source)
      )
    );

    for (const { record } of items) {
      const index = records.findIndex((item) => item.id === record.id);
      if (index >= 0) records[index] = record;
      else records.push(record);
    }
    records.sort((left, right) => left.id.localeCompare(right.id));
    await atomicWriteFile(this.recordsFile, `${JSON.stringify(records, null, 2)}\n`);
    const referenced = new Set(records.map((record) => record.sourceFile));
    await Promise.all(
      [...staleFiles]
        .filter((sourceFile) => !referenced.has(sourceFile))
        .map((sourceFile) => rm(path.join(this.originalsDir, sourceFile), { force: true }))
    );
  }

  async replaceAll(records: IconRecord[]): Promise<void> {
    return this.withMutationLock(async () => {
      await atomicWriteFile(
        this.recordsFile,
        `${JSON.stringify([...records].sort((left, right) => left.id.localeCompare(right.id)), null, 2)}\n`
      );
    });
  }

  async remove(iconId: string): Promise<IconRecord | null> {
    return this.withMutationLock(async () => this.removeUnlocked(iconId));
  }

  private async removeUnlocked(iconId: string): Promise<IconRecord | null> {
    const records = await this.list();
    const index = records.findIndex((record) => record.id === iconId);
    if (index < 0) return null;

    const [record] = records.splice(index, 1);
    await ensureDirectory(this.originalsDir);
    const sourceFiles = (await readdir(this.originalsDir)).filter(
      (file) => file === record!.sourceFile || file.startsWith(`${iconId}.`)
    );
    const stagingDir = path.join(path.dirname(this.recordsFile), ".deleting", randomUUID());
    await ensureDirectory(stagingDir);
    const moved: string[] = [];
    let metadataCommitted = false;

    try {
      for (const sourceFile of sourceFiles) {
        await rename(
          path.join(this.originalsDir, sourceFile),
          path.join(stagingDir, sourceFile)
        );
        moved.push(sourceFile);
      }
      await atomicWriteFile(this.recordsFile, `${JSON.stringify(records, null, 2)}\n`);
      metadataCommitted = true;
      await rm(stagingDir, { recursive: true, force: true });
      return record!;
    } catch (error) {
      if (!metadataCommitted) {
        for (const sourceFile of moved.reverse()) {
          await rename(
            path.join(stagingDir, sourceFile),
            path.join(this.originalsDir, sourceFile)
          ).catch(() => undefined);
        }
        await rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
      }
      throw error;
    }
  }

  private withMutationLock<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation, operation);
    this.mutationQueue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }
}

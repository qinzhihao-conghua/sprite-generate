import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createConfig } from "../src/config.js";

export async function temporaryConfig() {
  const root = await mkdtemp(path.join(os.tmpdir(), "sprite-generate-test-"));
  return {
    root,
    config: createConfig({
      dataDir: path.join(root, "data"),
      publicDir: path.join(root, "public"),
      generatedDir: path.join(root, "output")
    })
  };
}

export function svg(color = "#e95e3e", extra = ""): Buffer {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60" viewBox="0 0 120 60"><rect x="20" y="10" width="80" height="40" rx="8" fill="${color}"/>${extra}</svg>`
  );
}

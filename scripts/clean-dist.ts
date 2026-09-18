import { rm } from "node:fs/promises";
import path from "node:path";

await Promise.all(
  [".build", "dist"].map((directory) =>
    rm(path.join(process.cwd(), directory), { recursive: true, force: true })
  )
);

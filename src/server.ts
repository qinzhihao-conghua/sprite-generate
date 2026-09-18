import { startProjectServer } from "./runtime.js";

startProjectServer().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

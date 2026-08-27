import { createApp } from "./app.js";
import { createConfig } from "./config.js";

const config = createConfig();
const { app } = createApp(config);
const port = Number(process.env.PORT ?? 3000);

app.listen(port, () => {
  console.log(`Sprite Generator 已启动：http://localhost:${port}`);
});

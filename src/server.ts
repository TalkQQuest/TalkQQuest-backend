import { env } from "./config/env";
import { logger } from "./config/logger";
import { createApp } from "./app";

const app = createApp();

app.listen(env.PORT, () => {
  logger.info(`TalkQuest API listening on http://localhost:${env.PORT}`);
  logger.info(`Swagger docs: http://localhost:${env.PORT}/docs`);
});

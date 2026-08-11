import http from "http";
import { env } from "./config/env";
import { logger } from "./config/logger";
import { createApp } from "./app";
import { initChatSocket } from "./modules/community/realtime/chat.socket";
import { startMissionReminderScheduler } from "./modules/notification/services/mission-reminder-scheduler.service";

const app = createApp();
// Socket.IO는 express app이 아니라 그 밑의 raw http.Server에 붙어야 해서
// (WebSocket 업그레이드 요청을 가로채는 방식이라) http.createServer로 감싸서 넘긴다.
const httpServer = http.createServer(app);

initChatSocket(httpServer);
startMissionReminderScheduler();

httpServer.listen(env.PORT, () => {
  logger.info(`TalkQuest API listening on http://localhost:${env.PORT}`);
  logger.info(`Swagger docs: http://localhost:${env.PORT}/docs`);
  logger.info(`Chat WebSocket: ws://localhost:${env.PORT}/communities`);
});

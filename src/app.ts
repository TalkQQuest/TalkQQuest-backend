import "./config/env";
import express, { Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import fs from "fs";
import path from "path";
import swaggerUi from "swagger-ui-express";
import { logger } from "./config/logger";
import { requestId } from "./middlewares/requestId";
import { errorHandler, notFoundHandler } from "./middlewares/errorHandler";
// tsoa가 생성하는 파일입니다. `npm run tsoa:gen` (또는 dev/build 스크립트)을 한 번 실행해야 생성됩니다.
import { RegisterRoutes } from "./generated/routes";

export const createApp = (): Express => {
  const app = express();

  app.use(requestId);
  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser());
  // requestId 미들웨어가 먼저 실행되어 req.requestId가 채워진 뒤,
  // pino-http가 같은 id를 로그 컨텍스트로 사용합니다 (CONVENTION.md `## 3.11 로깅` 참고).
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as express.Request).requestId ?? "",
    })
  );

  const router = express.Router();
  RegisterRoutes(router);
  app.use("/api/v1", router);

  // tsoa가 생성한 swagger.json을 그대로 노출합니다.
  const swaggerPath = path.resolve(__dirname, "../dist/swagger.json");
  if (fs.existsSync(swaggerPath)) {
    const swaggerDocument = JSON.parse(fs.readFileSync(swaggerPath, "utf8"));
    app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};

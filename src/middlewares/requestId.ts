import { NextFunction, Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";

// requirements.md Requirement 10.6: 모든 요청에 X-Request-Id를 부여하고 응답 헤더에 포함합니다.
export const requestId = (req: Request, res: Response, next: NextFunction) => {
  const incoming = req.header("X-Request-Id");
  const id = incoming && incoming.length > 0 ? incoming : uuidv4();
  req.requestId = id;
  res.setHeader("X-Request-Id", id);
  next();
};

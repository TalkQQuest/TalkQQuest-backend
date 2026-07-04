import { NextFunction, Request, Response } from "express";
import { logger } from "../config/logger";
import { AppError } from "../shared/errors/app-error";
import { ErrorCodes } from "../shared/constants/error-codes";
import { failure } from "../shared/utils/response";

// requirements.md Requirement 10.5: 서버 내부 오류는 500과 일반 메시지를 반환하고 상세는 로그에만 남깁니다.
// CONVENTION.md `## 3.8 Exception / Error Code` 참고.
export const errorHandler = (
  err: unknown,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  next: NextFunction
) => {
  if (res.headersSent) {
    return;
  }

  if (err instanceof AppError) {
    return res.status(err.statusCode).json(failure(err.errorCode, err.message));
  }

  logger.error({ requestId: req.requestId, err }, "처리되지 않은 서버 내부 오류");
  return res.status(500).json(failure(ErrorCodes.SERVER_ERROR, "서버 내부 오류가 발생했습니다"));
};

export const notFoundHandler = (req: Request, res: Response) => {
  return res
    .status(404)
    .json(failure(ErrorCodes.NOT_FOUND, `요청한 경로를 찾을 수 없습니다: ${req.originalUrl}`));
};

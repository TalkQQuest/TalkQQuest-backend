import { NextFunction, Request, Response } from "express";
import { ZodSchema } from "zod";
import { ValidationError } from "../shared/errors/common.error";

// CONVENTION.md `## 3.4 Validation` 참고.
// 컨트롤러 메서드에 @Middlewares(validate(스키마))로 연결해서 사용합니다.
export const validate = (schema: ZodSchema) =>
  (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      // 첫 번째 zod 이슈의 메시지를 그대로 노출한다 — 각 스키마의 .min(1, "...")에서
      // 정의한 필드별 구체적 안내 문구가 응답에 그대로 실리도록.
      const firstIssueMessage = result.error.issues[0]?.message;
      return next(new ValidationError(firstIssueMessage, result.error.issues));
    }
    req.body = result.data;
    next();
  };
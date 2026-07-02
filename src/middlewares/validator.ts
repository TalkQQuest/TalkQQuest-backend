import { NextFunction, Request, Response } from "express";
import { ZodSchema } from "zod";
import { ValidationError } from "../shared/errors/common.error";

// CONVENTION.md `## 3.4 Validation` 참고.
// 컨트롤러 메서드에 @Middlewares(validate(스키마))로 연결해서 사용합니다.
export const validate = (schema: ZodSchema) =>
  (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return next(new ValidationError(result.error.issues));
    }
    req.body = result.data;
    next();
  };

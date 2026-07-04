import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { UnauthorizedError } from "../shared/errors/common.error";

interface AccessTokenPayload {
  sub: string;
  email: string | null;
}

// CONVENTION.md `## 3.9 인증 (JWT)` 참고.
// passport 등 외부 인증 프레임워크 없이 Access Token(JWT)을 직접 검증합니다.
export const authenticate = (req: Request, _res: Response, next: NextFunction) => {
  const header = req.header("Authorization");
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;

  if (!token) {
    return next(new UnauthorizedError("Access Token이 필요합니다"));
  }

  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload;
    req.user = { id: payload.sub, email: payload.email };
    next();
  } catch {
    next(new UnauthorizedError("Access Token이 유효하지 않거나 만료되었습니다"));
  }
};

// tsoa @Middlewares()에 바로 연결할 수 있는 형태로도 export 해둡니다.
export const authorizeUser = () => authenticate;

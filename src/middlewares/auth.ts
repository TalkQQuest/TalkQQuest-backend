import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { ForbiddenError, UnauthorizedError } from "../shared/errors/common.error";
import * as adminRepository from "../modules/admin/repositories/admin.repository";

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

// 관리자 전용 엔드포인트(playbook CRUD, setup-guideline/regenerate 등)에서
// authorizeUser() 바로 뒤에 이어 붙인다 — 인증(신원 확인)과 인가(권한 확인)를 분리해,
// 순서가 바뀌면 req.user가 없는 채로 DB 조회를 시도하지 않도록 한다.
// Admin_Users에 행이 있는지만 확인한다(#208 — Users에 role 컬럼을 두지 않고 분리한 테이블).
export const authorizeAdmin = () => async (req: Request, _res: Response, next: NextFunction) => {
  if (!req.user) {
    return next(new UnauthorizedError("Access Token이 필요합니다"));
  }

  try {
    const isAdmin = await adminRepository.isAdminUser(req.user.id);
    if (!isAdmin) {
      return next(new ForbiddenError("관리자만 접근할 수 있습니다"));
    }
    next();
  } catch (error) {
    next(error);
  }
};

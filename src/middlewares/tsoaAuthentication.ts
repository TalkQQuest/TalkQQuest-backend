import { Request } from "express";
import { UnauthorizedError } from "../shared/errors/common.error";

// tsoa @Security()가 스웨거 스펙에 "이 API는 인증이 필요하다"는 정보를 남기고,
// Swagger UI Authorize 버튼으로 넣은 토큰을 실제 요청 헤더에 실어주도록 하기 위한
// 최소 연결부입니다. 실제 토큰 검증(서명/만료 확인)은 여기서 하지 않고,
// 기존 middlewares/auth.ts의 authorizeUser()가 이어서 그대로 수행합니다
// (CONVENTION.md `## 3.9` — passport 등 외부 인증 프레임워크를 쓰지 않고
// JWT를 직접 검증한다는 원칙은 그대로 유지).
export const expressAuthentication = async (
  request: Request,
  securityName: string
): Promise<Record<string, never>> => {
  if (securityName !== "bearerAuth") {
    throw new UnauthorizedError("지원하지 않는 인증 방식입니다");
  }

  const header = request.header("Authorization");
  if (!header?.startsWith("Bearer ")) {
    throw new UnauthorizedError("Access Token이 필요합니다");
  }

  return {};
};

import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import { env } from "../../../config/env";
import { UnauthorizedError } from "../../../shared/errors/common.error";
import {
  createRefreshToken,
  findActiveRefreshToken,
  revokeRefreshToken,
} from "../repositories/auth.repository";

// CONVENTION.md `## 3.9 인증 (JWT)` 참고 — Access/Refresh Token 발급.
const ACCESS_TOKEN_EXPIRES_IN_SECONDS = 60 * 60; // 1h, JWT_ACCESS_EXPIRES_IN과 별개로 응답의 expiresIn 필드에 사용

export const issueTokens = async (
  userId: string,
  email: string | null,
  deviceInfo?: unknown
): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> => {
  const accessToken = jwt.sign({ sub: userId, email }, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRES_IN as jwt.SignOptions["expiresIn"],
  });

  const refreshTokenId = uuidv4();
  const refreshToken = jwt.sign({ sub: userId, jti: refreshTokenId }, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_EXPIRES_IN as jwt.SignOptions["expiresIn"],
  });

  const decoded = jwt.decode(refreshToken) as { exp: number };
  await createRefreshToken(userId, refreshToken, new Date(decoded.exp * 1000), deviceInfo);

  return { accessToken, refreshToken, expiresIn: ACCESS_TOKEN_EXPIRES_IN_SECONDS };
};

// design.md `#### POST /auth/refresh` 참고 — 새 Refresh Token은 발급하지 않고 Access Token만 재발급한다.
export const refreshAccessToken = async (
  refreshToken: string
): Promise<{ accessToken: string; expiresIn: number }> => {
  let payload: { sub: string };
  try {
    payload = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET) as { sub: string };
  } catch {
    throw new UnauthorizedError("Refresh Token이 유효하지 않거나 만료되었습니다");
  }

  const stored = await findActiveRefreshToken(refreshToken);
  if (!stored) {
    throw new UnauthorizedError("Refresh Token이 유효하지 않거나 만료되었습니다");
  }

  // Refresh Token에는 email이 없어 재발급된 Access Token payload의 email은 null로 둔다.
  // middlewares/auth.ts는 인가 시 sub(userId)만 사용하므로 현재는 영향 없다.
  const accessToken = jwt.sign({ sub: payload.sub, email: null }, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRES_IN as jwt.SignOptions["expiresIn"],
  });

  return { accessToken, expiresIn: ACCESS_TOKEN_EXPIRES_IN_SECONDS };
};

export const logout = async (refreshToken: string): Promise<void> => {
  const stored = await findActiveRefreshToken(refreshToken);
  if (!stored) {
    throw new UnauthorizedError("Refresh Token이 유효하지 않거나 이미 로그아웃되었습니다");
  }
  await revokeRefreshToken(refreshToken);
};

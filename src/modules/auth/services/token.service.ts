import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import { env } from "../../../config/env";
import { UnauthorizedError } from "../../../shared/errors/common.error";
import { RefreshTokenExpiredError } from "../errors/auth.error";
import {
  createRefreshToken,
  findActiveRefreshToken,
  findAnyIdentityEmailByUserId,
  revokeRefreshToken,
} from "../repositories/auth.repository";

// CONVENTION.md `## 3.9 인증 (JWT)` 참고 — Access/Refresh Token 발급.
// expiresIn은 env.JWT_ACCESS_EXPIRES_IN을 문자열로 파싱하지 않고, 방금 서명한 토큰의
// exp/iat 차이를 그대로 사용한다 — 실제 토큰 만료 시각과 항상 일치함이 보장된다.
const secondsUntilExpiry = (token: string): number => {
  const decoded = jwt.decode(token) as { iat: number; exp: number };
  return decoded.exp - decoded.iat;
};

const signAccessToken = (userId: string, email: string | null) =>
  jwt.sign({ sub: userId, email }, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRES_IN as jwt.SignOptions["expiresIn"],
  });

export const issueTokens = async (
  userId: string,
  email: string | null,
  deviceInfo?: unknown
): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> => {
  const accessToken = signAccessToken(userId, email);

  const refreshTokenId = uuidv4();
  const refreshToken = jwt.sign({ sub: userId, jti: refreshTokenId }, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_EXPIRES_IN as jwt.SignOptions["expiresIn"],
  });

  const decoded = jwt.decode(refreshToken) as { exp: number };
  await createRefreshToken(userId, refreshToken, new Date(decoded.exp * 1000), deviceInfo);

  return { accessToken, refreshToken, expiresIn: secondsUntilExpiry(accessToken) };
};

// API 명세서 `엑세스 토큰 재발급` 참고 — 새 Refresh Token은 발급하지 않고 Access Token만 재발급한다.
// 401 UNAUTHORIZED(위변조/revoked)와 410 EXPIRED(만료)를 구분한다.
export const refreshAccessToken = async (refreshToken: string): Promise<{ accessToken: string }> => {
  let payload: { sub: string };
  try {
    payload = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET) as { sub: string };
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new RefreshTokenExpiredError();
    }
    throw new UnauthorizedError("유효하지 않은 토큰입니다");
  }

  const stored = await findActiveRefreshToken(refreshToken);
  if (!stored) {
    throw new UnauthorizedError("유효하지 않은 토큰입니다");
  }

  // Refresh Token 자체엔 email이 없어, 재발급 시점에 DB에서 조회해 access token payload에 반영한다.
  const email = await findAnyIdentityEmailByUserId(payload.sub);
  const accessToken = signAccessToken(payload.sub, email);

  return { accessToken };
};

export const logout = async (refreshToken: string): Promise<void> => {
  const stored = await findActiveRefreshToken(refreshToken);
  if (!stored) {
    throw new UnauthorizedError("Refresh Token이 유효하지 않거나 이미 로그아웃되었습니다");
  }
  await revokeRefreshToken(refreshToken);
};

import { logger } from "../../../config/logger";
import { InvalidProviderTokenError } from "../errors/auth.error";

// design.md `### Auth APIs` > 소셜 로그인(Android 클라이언트) 인증 방식 참고.
// Authorization Code 교환 없이, 클라이언트가 전달한 Provider Access Token을 그대로
// 카카오/네이버의 사용자 정보 조회 API에 전달해 검증한다.

interface ProviderProfile {
  providerUserId: string;
  email: string | null;
}

export const verifyKakaoToken = async (providerAccessToken: string): Promise<ProviderProfile> => {
  const res = await fetch("https://kapi.kakao.com/v2/user/me", {
    headers: { Authorization: `Bearer ${providerAccessToken}` },
  });

  if (!res.ok) {
    logger.warn({ status: res.status }, "카카오 Access Token 검증 실패");
    throw new InvalidProviderTokenError();
  }

  const body = (await res.json()) as {
    id: number;
    kakao_account?: { email?: string };
  };

  return {
    providerUserId: String(body.id),
    email: body.kakao_account?.email ?? null,
  };
};

export const verifyNaverToken = async (providerAccessToken: string): Promise<ProviderProfile> => {
  const res = await fetch("https://openapi.naver.com/v1/nid/me", {
    headers: { Authorization: `Bearer ${providerAccessToken}` },
  });

  if (!res.ok) {
    logger.warn({ status: res.status }, "네이버 Access Token 검증 실패");
    throw new InvalidProviderTokenError();
  }

  const body = (await res.json()) as {
    resultcode: string;
    response?: { id: string; email?: string };
  };

  if (body.resultcode !== "00" || !body.response) {
    throw new InvalidProviderTokenError();
  }

  return {
    providerUserId: body.response.id,
    email: body.response.email ?? null,
  };
};

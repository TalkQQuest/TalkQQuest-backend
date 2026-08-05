// shared/ai/generate.ts
// "생성 → 검증 → 실패하면 1회 재시도 → 그래도 실패하면 폴백" 루프.
//
// 피드백·대화 응답이 각자 같은 구조를 갖고 있었다(Requirement 5.5).
// 중요한 건 **호출 실패뿐 아니라 "규칙을 어긴 응답"도 재시도 대상**이라는 점이다.
// 형식이 틀어진 응답을 그대로 쓰면 사용자에게 그대로 노출되기 때문에, 파싱·검증까지 통과한
// 결과만 성공으로 본다.

import { logger } from "../../config/logger";

// 기본 재시도 횟수. 최초 1회 + 재시도 1회 = 최대 2회 호출.
// LLM 비용·응답 지연과 성공률의 절충값이라 늘리려면 비용을 함께 봐야 한다.
const DEFAULT_RETRIES = 1;

export interface GenerateWithRetryOptions {
  /** 로그에서 어느 기능인지 구분할 이름 (예: "피드백", "대화 응답") */
  label: string;
  /** 최초 시도 이후 추가 시도 횟수. 기본 1회. */
  retries?: number;
}

/**
 * attempt를 실행해 유효한 결과(null이 아닌 값)가 나올 때까지 최대 1+retries회 시도한다.
 *
 * attempt는 **호출과 검증을 모두 마친 뒤** 성공이면 값을, 실패면 null을 반환해야 한다.
 * (호출은 성공했지만 검증에서 걸린 경우도 null로 돌려야 재시도가 걸린다.)
 * 모두 실패하면 null — 호출부가 폴백을 정한다.
 */
export const generateWithRetry = async <T>(
  attempt: () => Promise<T | null>,
  options: GenerateWithRetryOptions
): Promise<T | null> => {
  const retries = options.retries ?? DEFAULT_RETRIES;

  for (let i = 0; i <= retries; i += 1) {
    const result = await attempt();
    if (result !== null) return result;

    if (i < retries) {
      logger.warn({ label: options.label, attempt: i + 1 }, "AI 생성 실패 — 재시도");
    }
  }

  logger.warn({ label: options.label }, "AI 생성 재시도까지 실패 — 폴백");
  return null;
};

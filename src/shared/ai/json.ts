// shared/ai/json.ts
// LLM에게 JSON을 받아 검증하는 공통 처리.
//
// 도메인마다 같은 코드를 복붙하고 있었다(코드펜스 제거 → JSON.parse → zod → 실패 시 warn + null).
// 새 AI 기능을 붙일 때 이 파일의 parseJsonResponse만 쓰면 되도록 모아 둔다.

import { z } from "zod";
import { logger } from "../../config/logger";

// jsonMode를 켜도 모델이 ```json 코드펜스로 감싸는 경우가 있어 벗겨낸다.
export const stripCodeFence = (raw: string): string =>
  raw
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();

/**
 * LLM 원문 응답을 스키마로 검증해 파싱한다.
 * 실패(JSON 깨짐 / 스키마 불일치)하면 사유를 로깅하고 null을 반환한다 —
 * AI 응답은 언제든 형식이 틀어질 수 있으므로 예외 대신 null로 다뤄 호출부가 폴백·재시도를 정한다.
 *
 * @param label 로그에서 어느 기능인지 구분할 이름 (예: "피드백", "대화 플레이북")
 */
export const parseJsonResponse = <T>(
  raw: string,
  schema: z.ZodType<T>,
  label: string
): T | null => {
  let json: unknown;
  try {
    json = JSON.parse(stripCodeFence(raw));
  } catch {
    logger.warn({ label }, "LLM 응답 JSON 파싱 실패");
    return null;
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    logger.warn({ label, issues: parsed.error.issues }, "LLM 응답 스키마 검증 실패");
    return null;
  }
  return parsed.data;
};

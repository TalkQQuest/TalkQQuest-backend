// Upstage Solar (OpenAI 호환) chat completion 저수준 클라이언트.
// 미션 추천·대화·피드백 등 여러 도메인이 공유한다. 각 호출부가 자기 방식대로
// 결과(JSON 파싱 / 재시도 / 폴백 사유 매핑)를 처리할 수 있도록, 여기서는 성공 시 content 문자열,
// 실패 시 사유만 반환하는 얇은 계층만 담당한다.
import { env } from "../../config/env";
import { logger } from "../../config/logger";

export interface UpstageChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface UpstageChatOptions {
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean; // response_format: json_object 강제
}

// 성공(content) 또는 실패(사유). http_error는 상태 코드를 함께 담아 호출부가 활용할 수 있게 한다.
export type UpstageChatResult =
  | { ok: true; content: string }
  | { ok: false; reason: "no_api_key" | "timeout" | "network_error" | "empty_response" }
  | { ok: false; reason: "http_error"; status: number };

const REQUEST_TIMEOUT_MS = 10000;

const fetchWithTimeout = async (url: string, init: RequestInit): Promise<Response> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
};

export const callUpstageChat = async (
  messages: UpstageChatMessage[],
  options: UpstageChatOptions = {}
): Promise<UpstageChatResult> => {
  // 키가 없으면 로컬 개발/테스트에서도 도메인이 폴백으로 동작할 수 있게 조용히 실패를 반환한다.
  if (!env.UPSTAGE_API_KEY) {
    return { ok: false, reason: "no_api_key" };
  }

  try {
    const res = await fetchWithTimeout(`${env.UPSTAGE_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.UPSTAGE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: env.UPSTAGE_MODEL,
        messages,
        ...(options.temperature !== undefined && { temperature: options.temperature }),
        ...(options.maxTokens !== undefined && { max_tokens: options.maxTokens }),
        ...(options.jsonMode && { response_format: { type: "json_object" } }),
      }),
    });

    if (!res.ok) {
      return { ok: false, reason: "http_error", status: res.status };
    }

    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = body.choices?.[0]?.message?.content;
    if (!content || !content.trim()) {
      return { ok: false, reason: "empty_response" };
    }

    return { ok: true, content };
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === "AbortError";
    logger.warn({ err: error }, "Upstage 호출 실패");
    return { ok: false, reason: isTimeout ? "timeout" : "network_error" };
  }
};

// 호출부에서 로깅/모델명 표기에 쓰도록 현재 모델명을 노출한다.
export const upstageModel = (): string => env.UPSTAGE_MODEL;

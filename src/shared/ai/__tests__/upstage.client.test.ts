jest.mock("../../../config/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("../../../config/env", () => ({
  env: {
    UPSTAGE_API_KEY: "test-key",
    UPSTAGE_BASE_URL: "https://api.upstage.ai/v1",
    UPSTAGE_MODEL: "solar-pro",
  },
}));

import { env } from "../../../config/env";
import { callUpstageChat } from "../upstage.client";

const messages = [{ role: "user" as const, content: "안녕" }];

describe("callUpstageChat", () => {
  const mockFetch = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (env as { UPSTAGE_API_KEY?: string }).UPSTAGE_API_KEY = "test-key";
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  it("키가 없으면 fetch 없이 no_api_key를 반환한다", async () => {
    (env as { UPSTAGE_API_KEY?: string }).UPSTAGE_API_KEY = undefined;
    const result = await callUpstageChat(messages);
    expect(result).toEqual({ ok: false, reason: "no_api_key" });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("정상 응답이면 content를 반환한다", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "응답" } }] }),
    });
    const result = await callUpstageChat(messages);
    expect(result).toEqual({ ok: true, content: "응답" });
  });

  it("HTTP 오류면 상태코드를 담아 http_error를 반환한다", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 429, json: async () => ({}) });
    const result = await callUpstageChat(messages);
    expect(result).toEqual({ ok: false, reason: "http_error", status: 429 });
  });

  it("빈 응답이면 empty_response를 반환한다", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "  " } }] }),
    });
    const result = await callUpstageChat(messages);
    expect(result).toEqual({ ok: false, reason: "empty_response" });
  });

  it("타임아웃(AbortError)이면 timeout을 반환한다", async () => {
    const abortErr = new Error("aborted");
    abortErr.name = "AbortError";
    mockFetch.mockRejectedValue(abortErr);
    const result = await callUpstageChat(messages);
    expect(result).toEqual({ ok: false, reason: "timeout" });
  });

  it("그 외 네트워크 예외는 network_error를 반환한다", async () => {
    mockFetch.mockRejectedValue(new Error("boom"));
    const result = await callUpstageChat(messages);
    expect(result).toEqual({ ok: false, reason: "network_error" });
  });

  it("jsonMode/옵션을 요청 body에 반영한다", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "{}" } }] }),
    });
    await callUpstageChat(messages, { temperature: 0.7, maxTokens: 500, jsonMode: true });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.model).toBe("solar-pro");
    expect(body.temperature).toBe(0.7);
    expect(body.max_tokens).toBe(500);
    expect(body.response_format).toEqual({ type: "json_object" });
  });

  it("jsonMode가 아니면 response_format을 넣지 않는다", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "hi" } }] }),
    });
    await callUpstageChat(messages, { maxTokens: 10 });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.response_format).toBeUndefined();
    expect(body.temperature).toBeUndefined();
  });
});

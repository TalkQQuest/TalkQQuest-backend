jest.mock("../repositories/feedback.repository");
jest.mock("../services/feedback-llm.service", () => ({
  ...jest.requireActual("../services/feedback-llm.service"),
  generateFeedbackWithLlm: jest.fn(),
}));
jest.mock("../../badge/services/badge.service", () => ({
  checkAndAwardBadges: jest.fn(),
}));

import * as repository from "../repositories/feedback.repository";
import { generateFeedbackWithLlm } from "../services/feedback-llm.service";
import { checkAndAwardBadges } from "../../badge/services/badge.service";
import {
  FeedbackConversationNotFoundError,
  FeedbackInputTooShortError,
  FeedbackNotFoundError,
  FeedbackNotReadyError,
} from "../errors/feedback.error";
import { createFeedback, retryFeedback } from "../services/feedback.service";

const mockedRepo = jest.mocked(repository);
const mockedGenerate = jest.mocked(generateFeedbackWithLlm);
const mockedCheckAndAwardBadges = jest.mocked(checkAndAwardBadges);

const validMetric = {
  score: 90,
  strengths: ["잘했어요"],
  improvements: ["더 해보세요"],
  bestSentence: "안녕하세요",
};

const llmSuccess = () => ({
  metrics: { kindness: validMetric, initiative: validMetric, empathy: validMetric, questionLink: validMetric },
  missionSummary: ["장소 경험을 공유했어요"],
  savedPhrase: "오늘 날씨가 좋네요.",
});

const buildConversation = (overrides: Record<string, unknown> = {}) =>
  ({
    id: "c1",
    user_id: "u1",
    selected_topic: "처음 보는 사람에게 인사하기",
    mission: { title: "카페 인사하기", description: "먼저 인사해보세요" },
    messages: [
      { role: "user", content: "안녕하세요! 오늘 날씨가 좋네요" },
      { role: "guide", content: "그러게요" },
      { role: "user", content: "혹시 이 근처 자주 오세요?" },
    ],
    ...overrides,
  }) as never;

const metricRow = (key: string, label: string, score: number) => ({
  key,
  label,
  score,
  strengths: ["a"],
  improvements: ["b"],
  bestSentence: "c",
});

const buildFeedbackRow = (overrides: Record<string, unknown> = {}) =>
  ({
    id: "f1",
    user_id: "u1",
    conversation_id: "c1",
    kindness_score: 92,
    initiative_score: 88,
    empathy_score: 85,
    question_link_score: 78,
    // dev 형식: metrics 배열([{key,label,score,strengths,improvements,bestSentence}])로 저장
    metrics: [
      metricRow("kindness", "친절한 태도", 92),
      metricRow("initiative", "대화 주도", 88),
      metricRow("empathy", "공감 능력", 85),
      metricRow("questionLink", "질문 연결성", 78),
    ],
    mission_summary: ["장소 경험을 공유했어요"],
    saved_phrase: "오늘 날씨가 좋네요.",
    status: "ready",
    // topic은 컬럼이 아니라 conversation.selected_topic에서 온다 (findFeedbackByIdAndUserId include).
    conversation: { selected_topic: "처음 보는 사람에게 인사하기" },
    ...overrides,
  }) as never;

beforeEach(() => {
  jest.clearAllMocks();
  mockedRepo.markFeedbackPending.mockResolvedValue({} as never);
  mockedRepo.markFeedbackFailed.mockResolvedValue({} as never);
  mockedRepo.markFeedbackReady.mockResolvedValue({} as never);
  mockedCheckAndAwardBadges.mockResolvedValue([]);
});

describe("createFeedback", () => {
  it("대화가 없거나 다른 사용자 것이면 CONVERSATION_NOT_FOUND", async () => {
    mockedRepo.findConversationForFeedback.mockResolvedValue(null as never);

    await expect(createFeedback("u1", { conversationId: "c1" })).rejects.toBeInstanceOf(
      FeedbackConversationNotFoundError
    );
  });

  it("사용자 발화가 너무 적으면(2건 미만) FEEDBACK_INPUT_TOO_SHORT", async () => {
    mockedRepo.findConversationForFeedback.mockResolvedValue(
      buildConversation({ messages: [{ role: "user", content: "안녕" }] })
    );

    await expect(createFeedback("u1", { conversationId: "c1" })).rejects.toBeInstanceOf(
      FeedbackInputTooShortError
    );
    expect(mockedGenerate).not.toHaveBeenCalled();
  });

  it("사용자 발화 총 글자 수가 너무 짧으면 FEEDBACK_INPUT_TOO_SHORT", async () => {
    mockedRepo.findConversationForFeedback.mockResolvedValue(
      buildConversation({
        messages: [
          { role: "user", content: "네" },
          { role: "user", content: "넹" },
        ],
      })
    );

    await expect(createFeedback("u1", { conversationId: "c1" })).rejects.toBeInstanceOf(
      FeedbackInputTooShortError
    );
  });

  it("이미 pending인 피드백이 있으면 FEEDBACK_NOT_READY(409)", async () => {
    mockedRepo.findConversationForFeedback.mockResolvedValue(buildConversation());
    mockedRepo.findFeedbackByConversationId.mockResolvedValue(
      buildFeedbackRow({ status: "pending" })
    );

    await expect(createFeedback("u1", { conversationId: "c1" })).rejects.toBeInstanceOf(
      FeedbackNotReadyError
    );
    expect(mockedGenerate).not.toHaveBeenCalled();
  });

  it("이미 ready인 피드백이 있으면 재생성 없이 그대로 반환한다(멱등)", async () => {
    mockedRepo.findConversationForFeedback.mockResolvedValue(buildConversation());
    mockedRepo.findFeedbackByConversationId.mockResolvedValue(buildFeedbackRow());

    const result = await createFeedback("u1", { conversationId: "c1" });

    expect(result.status).toBe("ready");
    expect(result.overallScore).toBe(Math.round((92 + 88 + 85 + 78) / 4));
    expect(mockedGenerate).not.toHaveBeenCalled();
    expect(mockedRepo.createPendingFeedback).not.toHaveBeenCalled();
  });

  it("기존 피드백이 없으면 새로 만들고 동기로 생성해 ready로 반환한다", async () => {
    mockedRepo.findConversationForFeedback.mockResolvedValue(buildConversation());
    mockedRepo.findFeedbackByConversationId.mockResolvedValue(null as never);
    mockedRepo.createPendingFeedback.mockResolvedValue({ id: "f1" } as never);
    mockedGenerate.mockResolvedValue(llmSuccess());
    mockedRepo.findFeedbackByIdAndUserId.mockResolvedValue(buildFeedbackRow());

    const result = await createFeedback("u1", { conversationId: "c1" });

    expect(mockedRepo.createPendingFeedback).toHaveBeenCalledWith("u1", "c1");
    expect(mockedRepo.markFeedbackReady).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("ready");
    expect(result.metrics).toHaveLength(4);
    expect(result.metrics.map((m) => m.key)).toEqual([
      "kindness",
      "initiative",
      "empathy",
      "questionLink",
    ]);
  });

  it("LLM이 재시도까지 실패하면 가짜 분석 없이 status=failed로 반환한다", async () => {
    mockedRepo.findConversationForFeedback.mockResolvedValue(buildConversation());
    mockedRepo.findFeedbackByConversationId.mockResolvedValue(null as never);
    mockedRepo.createPendingFeedback.mockResolvedValue({ id: "f1" } as never);
    mockedGenerate.mockResolvedValue(null);
    mockedRepo.findFeedbackByIdAndUserId.mockResolvedValue(buildFeedbackRow({ status: "failed" }));

    const result = await createFeedback("u1", { conversationId: "c1" });

    expect(mockedRepo.markFeedbackFailed).toHaveBeenCalledWith("f1");
    expect(mockedRepo.markFeedbackReady).not.toHaveBeenCalled();
    expect(result.status).toBe("failed");
    expect(result.metrics.every((m) => m.score === 0)).toBe(true);
  });

  it("이전에 failed였던 피드백은 같은 행을 pending으로 돌려 재생성한다(새 행 생성 안 함)", async () => {
    mockedRepo.findConversationForFeedback.mockResolvedValue(buildConversation());
    mockedRepo.findFeedbackByConversationId.mockResolvedValue(
      buildFeedbackRow({ status: "failed" })
    );
    mockedGenerate.mockResolvedValue(llmSuccess());
    mockedRepo.findFeedbackByIdAndUserId.mockResolvedValue(buildFeedbackRow());

    await createFeedback("u1", { conversationId: "c1" });

    expect(mockedRepo.createPendingFeedback).not.toHaveBeenCalled();
    expect(mockedRepo.markFeedbackPending).toHaveBeenCalledWith("f1");
  });
});

describe("retryFeedback", () => {
  it("피드백이 없으면 FEEDBACK_NOT_FOUND", async () => {
    mockedRepo.findFeedbackByIdAndUserId.mockResolvedValue(null as never);

    await expect(retryFeedback("u1", "f1")).rejects.toBeInstanceOf(FeedbackNotFoundError);
  });

  it("이미 pending이면 FEEDBACK_NOT_READY(409)", async () => {
    mockedRepo.findFeedbackByIdAndUserId.mockResolvedValue(buildFeedbackRow({ status: "pending" }));

    await expect(retryFeedback("u1", "f1")).rejects.toBeInstanceOf(FeedbackNotReadyError);
  });

  it("정상 요청이면 즉시 status=pending을 반환한다 (생성은 응답 이후 진행)", async () => {
    mockedRepo.findFeedbackByIdAndUserId.mockResolvedValue(buildFeedbackRow({ status: "failed" }));
    mockedRepo.findConversationForFeedback.mockResolvedValue(buildConversation());
    mockedGenerate.mockResolvedValue(llmSuccess()); // 백그라운드에서 사용될 값

    const result = await retryFeedback("u1", "f1");

    expect(result).toEqual({ feedbackId: "f1", status: "pending" });
    expect(mockedRepo.markFeedbackPending).toHaveBeenCalledWith("f1");
  });
});

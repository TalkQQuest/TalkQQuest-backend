jest.mock("../repositories/feedback.repository");
jest.mock("../services/feedback-llm.service", () => ({
  ...jest.requireActual("../services/feedback-llm.service"),
  generateFeedbackWithLlm: jest.fn(),
}));
jest.mock("../../badge/services/badge.service", () => ({
  checkAndAwardBadges: jest.fn(),
}));
// #262 — mergeExtractedInterests(fire-and-forget)가 이 두 함수를 실제로 호출하는지,
// 병합 결과가 맞는지 검증하기 위해 mock한다.
jest.mock("../../user/repositories/user.repository", () => ({
  ...jest.requireActual("../../user/repositories/user.repository"),
  mergeExtractedInterests: jest.fn(),
}));
// runGeneration이 fire-and-forget으로 부르는 다른 부수효과들(성장 프로필 갱신, 주간
// 리포트 생성)은 실제 함수 그대로 두면 내부에서 Prisma를 호출해 테스트가 느려지거나
// unhandled rejection 경고가 뜰 수 있다 — 조용히 무력화한다.
jest.mock("../../growth/services/growth-profile.service", () => ({
  refreshGrowthProfile: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../../report/services/weekly-compare.service", () => ({
  generateMissingWeeklyReports: jest.fn().mockResolvedValue([]),
}));
jest.mock("../../report/services/report.service", () => ({
  notifyNewWeeklyCompareReports: jest.fn().mockResolvedValue(undefined),
}));

import * as repository from "../repositories/feedback.repository";
import { generateFeedbackWithLlm } from "../services/feedback-llm.service";
import { checkAndAwardBadges } from "../../badge/services/badge.service";
import { mergeExtractedInterests } from "../../user/repositories/user.repository";
import {
  FeedbackConversationNotFoundError,
  FeedbackInputTooShortError,
  FeedbackNotFoundError,
  FeedbackNotReadyError,
} from "../errors/feedback.error";
import { createFeedback, retryFeedback } from "../services/feedback.service";

const mockedMergeInterests = jest.mocked(mergeExtractedInterests);

const mockedRepo = jest.mocked(repository);
const mockedGenerate = jest.mocked(generateFeedbackWithLlm);
const mockedCheckAndAwardBadges = jest.mocked(checkAndAwardBadges);

const validMetric = {
  score: 90,
  strengths: ["잘했어요"],
  improvements: ["더 해보세요"],
  bestSentence: "안녕하세요",
};

const llmSuccess = (overrides: Record<string, unknown> = {}) => ({
  metrics: { kindness: validMetric, initiative: validMetric, empathy: validMetric, questionLink: validMetric },
  missionSummary: ["장소 경험을 공유했어요"],
  summaryChips: ["자기성장", "첫 만남", "스몰토크"],
  conversationSummary: "카페에서 처음 만난 사람과 날씨 이야기를 나눴습니다.",
  cardSummary: "처음 만난 사람과 인사를 나눴어요.",
  conversationHighlights: ["먼저 인사를 건넸어요", "날씨 이야기로 대화를 이어갔어요"],
  extractedInterests: [],
  savedPhrase: "오늘 날씨가 좋네요.",
  ...overrides,
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

const storedPlaybook = (metadata: Record<string, unknown> = {}) => ({
  ...metadata,
  flow: [
    { step: "인사", advanceExamples: ["안녕하세요"] },
    { step: "대화", advanceExamples: ["어떤 메뉴를 좋아하세요?"] },
    { step: "마무리", advanceExamples: ["다음에 또 봬요"] },
  ],
  responseRules: [{ when: "사용자가 막힘", then: "선택지를 제시한다", whenEmbedding: [1, 0] }],
});

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
    summary_chips: ["자기성장", "첫 만남", "스몰토크"],
    conversation_summary: "카페에서 처음 만난 사람과 날씨 이야기를 나눴습니다.",
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
  // 기본값: 프로필이 없으면 mergeExtractedInterests가 조용히 종료한다.
  // 관심사 병합을 검증하는 테스트에서만 개별적으로 override한다.
  mockedMergeInterests.mockResolvedValue(undefined);
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

  // #262 — 대화에서 추출된 관심사를 User_Profiles.interests에 병합 반영한다.
  describe("관심사 자동 반영(mergeExtractedInterests)", () => {
    it("추출된 관심사가 없으면 mergeExtractedInterests를 호출하지 않는다", async () => {
      mockedRepo.findConversationForFeedback.mockResolvedValue(buildConversation());
      mockedRepo.findFeedbackByConversationId.mockResolvedValue(null as never);
      mockedRepo.createPendingFeedback.mockResolvedValue({ id: "f1" } as never);
      mockedGenerate.mockResolvedValue(llmSuccess({ extractedInterests: ["카페", "산책"] }));
      mockedRepo.findFeedbackByIdAndUserId.mockResolvedValue(buildFeedbackRow());

      await createFeedback("u1", { conversationId: "c1" });
      await new Promise((resolve) => setImmediate(resolve));

      expect(mockedMergeInterests).toHaveBeenCalledWith("u1", ["카페", "산책"], 10);
    });

    it("추출된 관심사가 없으면 mergeExtractedInterests를 호출하지 않는다", async () => {
      mockedRepo.findConversationForFeedback.mockResolvedValue(buildConversation());
      mockedRepo.findFeedbackByConversationId.mockResolvedValue(null as never);
      mockedRepo.createPendingFeedback.mockResolvedValue({ id: "f1" } as never);
      mockedGenerate.mockResolvedValue(llmSuccess({ extractedInterests: [] }));
      mockedRepo.findFeedbackByIdAndUserId.mockResolvedValue(buildFeedbackRow());

      await createFeedback("u1", { conversationId: "c1" });
      await new Promise((resolve) => setImmediate(resolve));

      expect(mockedMergeInterests).not.toHaveBeenCalled();
    });

    it("관심사 갱신이 실패해도 피드백 생성 자체는 정상적으로 완료된다", async () => {
      mockedRepo.findConversationForFeedback.mockResolvedValue(buildConversation());
      mockedRepo.findFeedbackByConversationId.mockResolvedValue(null as never);
      mockedRepo.createPendingFeedback.mockResolvedValue({ id: "f1" } as never);
      mockedGenerate.mockResolvedValue(llmSuccess({ extractedInterests: ["카페"] }));
      mockedRepo.findFeedbackByIdAndUserId.mockResolvedValue(buildFeedbackRow());
      mockedMergeInterests.mockRejectedValue(new Error("DB 오류"));

      const result = await createFeedback("u1", { conversationId: "c1" });
      await new Promise((resolve) => setImmediate(resolve));

      expect(result.status).toBe("ready");
    });
  });

  // #247 — 채점 프롬프트에 "최소한의 의사 표현만 한 경우 50~59점" 밴드가 명시돼 있음에도
// LLM이 이를 지키지 않아 실제로는 80점대가 나오는 사례가 있었다. 발화 분량이 최소 기준을
// 겨우 넘긴 수준이면 서버에서 점수 상한(59점)을 강제한다.
describe("createFeedback — 최소 입력 점수 상한(#247)", () => {
  it("발화가 최소 기준을 겨우 넘긴 수준이면 LLM 점수가 높아도 59점으로 클램프된다", async () => {
    // 기본 buildConversation()의 user 발화 2개, 총 글자 수는 40자 미만(최소 기준의 2배 미만)이라
    // isMinimalInput이 true가 되는 케이스다.
    mockedRepo.findConversationForFeedback.mockResolvedValue(buildConversation());
    mockedRepo.findFeedbackByConversationId.mockResolvedValue(null as never);
    mockedRepo.createPendingFeedback.mockResolvedValue({ id: "f1" } as never);
    mockedGenerate.mockResolvedValue(llmSuccess()); // validMetric.score = 90
    mockedRepo.findFeedbackByIdAndUserId.mockResolvedValue(buildFeedbackRow());

    await createFeedback("u1", { conversationId: "c1" });

    expect(mockedRepo.markFeedbackReady).toHaveBeenCalledWith(
      "f1",
      expect.objectContaining({
        kindnessScore: 59,
        initiativeScore: 59,
        empathyScore: 59,
        questionLinkScore: 59,
      })
    );
  });

  it("발화가 충분히 많으면 LLM 점수가 그대로 유지된다", async () => {
    mockedRepo.findConversationForFeedback.mockResolvedValue(
      buildConversation({
        messages: [
          {
            role: "user",
            content:
              "안녕하세요! 오늘 날씨가 정말 좋네요. 이 근처 자주 오시나요? 저는 오늘 처음 와봤는데 분위기가 참 좋은 것 같아요.",
          },
          { role: "guide", content: "그러게요, 저도 여기 자주 와요" },
          {
            role: "user",
            content:
              "그렇군요! 혹시 추천해주실 만한 메뉴가 있을까요? 저는 커피 종류를 잘 몰라서 고민이 되네요.",
          },
        ],
      })
    );
    mockedRepo.findFeedbackByConversationId.mockResolvedValue(null as never);
    mockedRepo.createPendingFeedback.mockResolvedValue({ id: "f1" } as never);
    mockedGenerate.mockResolvedValue(llmSuccess()); // validMetric.score = 90
    mockedRepo.findFeedbackByIdAndUserId.mockResolvedValue(buildFeedbackRow());

    await createFeedback("u1", { conversationId: "c1" });

    expect(mockedRepo.markFeedbackReady).toHaveBeenCalledWith(
      "f1",
      expect.objectContaining({
        kindnessScore: 90,
        initiativeScore: 90,
        empathyScore: 90,
        questionLinkScore: 90,
      })
    );
  });

  it("최소 입력이어도 LLM이 이미 상한보다 낮은 점수를 줬다면 그대로 유지한다(더 깎지 않음)", async () => {
    const lowMetric = {
      score: 40,
      strengths: ["잘했어요"],
      improvements: ["더 해보세요"],
      bestSentence: "안녕하세요",
    };
    mockedRepo.findConversationForFeedback.mockResolvedValue(buildConversation());
    mockedRepo.findFeedbackByConversationId.mockResolvedValue(null as never);
    mockedRepo.createPendingFeedback.mockResolvedValue({ id: "f1" } as never);
    mockedGenerate.mockResolvedValue({
      metrics: {
        kindness: lowMetric,
        initiative: lowMetric,
        empathy: lowMetric,
        questionLink: lowMetric,
      },
      missionSummary: ["장소 경험을 공유했어요"],
      summaryChips: ["자기성장", "첫 만남", "스몰토크"],
      conversationSummary: "카페에서 처음 만난 사람과 날씨 이야기를 나눴습니다.",
      cardSummary: "처음 만난 사람과 인사를 나눴어요.",
      conversationHighlights: ["먼저 인사를 건넸어요", "날씨 이야기로 대화를 이어갔어요"],
      extractedInterests: [],
      savedPhrase: "오늘 날씨가 좋네요.",
    });
    mockedRepo.findFeedbackByIdAndUserId.mockResolvedValue(buildFeedbackRow());

    await createFeedback("u1", { conversationId: "c1" });

    expect(mockedRepo.markFeedbackReady).toHaveBeenCalledWith(
      "f1",
      expect.objectContaining({
        kindnessScore: 40,
        initiativeScore: 40,
        empathyScore: 40,
        questionLinkScore: 40,
      })
    );
  });
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

  it("Playbook의 평가 메타데이터만 LLM context로 전달한다", async () => {
    mockedRepo.findConversationForFeedback.mockResolvedValue(
      buildConversation({
        mission: {
          title: "카페 인사하기",
          description: "먼저 인사해보세요",
          playbook: {
            data: storedPlaybook({
              objective: "처음 만난 사람과 자연스럽게 대화를 시작한다.",
              successCriteria: ["사용자가 먼저 인사한다."],
              feedbackFocus: ["대화를 시작하는 표현"],
            }),
          },
        },
      })
    );
    mockedRepo.findFeedbackByConversationId.mockResolvedValue(null as never);
    mockedRepo.createPendingFeedback.mockResolvedValue({ id: "f1" } as never);
    mockedGenerate.mockResolvedValue(llmSuccess());
    mockedRepo.findFeedbackByIdAndUserId.mockResolvedValue(buildFeedbackRow());

    await createFeedback("u1", { conversationId: "c1" });

    expect(mockedGenerate).toHaveBeenCalledWith(
      expect.any(Array),
      "카페 인사하기",
      "먼저 인사해보세요",
      {
        objective: "처음 만난 사람과 자연스럽게 대화를 시작한다.",
        successCriteria: ["사용자가 먼저 인사한다."],
        feedbackFocus: ["대화를 시작하는 표현"],
      }
    );
    const context = mockedGenerate.mock.calls[0][3] as Record<string, unknown>;
    expect(context).not.toHaveProperty("flow");
    expect(context).not.toHaveProperty("responseRules");
  });

  it.each([
    ["Playbook 없음", undefined],
    ["잘못된 Playbook", { unexpected: "shape" }],
    ["평가 메타데이터가 없는 구형 Playbook", storedPlaybook()],
  ])("%s이면 기존 방식으로 생성한다", async (_label, data) => {
    mockedRepo.findConversationForFeedback.mockResolvedValue(
      buildConversation({
        mission: {
          title: "카페 인사하기",
          description: "먼저 인사해보세요",
          ...(data === undefined ? {} : { playbook: { data } }),
        },
      })
    );
    mockedRepo.findFeedbackByConversationId.mockResolvedValue(null as never);
    mockedRepo.createPendingFeedback.mockResolvedValue({ id: "f1" } as never);
    mockedGenerate.mockResolvedValue(llmSuccess());
    mockedRepo.findFeedbackByIdAndUserId.mockResolvedValue(buildFeedbackRow());

    await createFeedback("u1", { conversationId: "c1" });

    expect(mockedGenerate).toHaveBeenCalledWith(
      expect.any(Array),
      "카페 인사하기",
      "먼저 인사해보세요",
      undefined
    );
  });

  it("successCriteria와 feedbackFocus 중 존재하는 값만 전달한다", async () => {
    mockedRepo.findConversationForFeedback.mockResolvedValue(
      buildConversation({
        mission: {
          title: "카페 인사하기",
          description: null,
          playbook: { data: storedPlaybook({ successCriteria: ["사용자가 먼저 인사한다."] }) },
        },
      })
    );
    mockedRepo.findFeedbackByConversationId.mockResolvedValue(null as never);
    mockedRepo.createPendingFeedback.mockResolvedValue({ id: "f1" } as never);
    mockedGenerate.mockResolvedValue(llmSuccess());
    mockedRepo.findFeedbackByIdAndUserId.mockResolvedValue(buildFeedbackRow());

    await createFeedback("u1", { conversationId: "c1" });

    expect(mockedGenerate.mock.calls[0][3]).toEqual({
      successCriteria: ["사용자가 먼저 인사한다."],
    });
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

  it("failed Feedback retry에도 동일한 Playbook 평가 context를 적용한다", async () => {
    mockedRepo.findFeedbackByIdAndUserId.mockResolvedValue(buildFeedbackRow({ status: "failed" }));
    mockedRepo.findConversationForFeedback.mockResolvedValue(
      buildConversation({
        mission: {
          title: "카페 인사하기",
          description: "먼저 인사해보세요",
          playbook: {
            data: storedPlaybook({ feedbackFocus: ["상대 답변과 연결된 후속 질문"] }),
          },
        },
      })
    );
    mockedGenerate.mockResolvedValue(llmSuccess());

    await retryFeedback("u1", "f1");

    expect(mockedGenerate).toHaveBeenCalledWith(
      expect.any(Array),
      "카페 인사하기",
      "먼저 인사해보세요",
      { feedbackFocus: ["상대 답변과 연결된 후속 질문"] }
    );
  });
});

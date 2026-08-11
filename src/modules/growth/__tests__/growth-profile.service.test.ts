import * as growthRepository from "../repositories/growth-profile.repository";
import * as summaryService from "../services/growth-summary.service";
import {
  getGrowthProfileForRecommendation,
  refreshGrowthProfile,
} from "../services/growth-profile.service";

jest.mock("../repositories/growth-profile.repository");
jest.mock("../services/growth-summary.service");

const mockedRepo = jest.mocked(growthRepository);
const mockedSummary = jest.mocked(summaryService);

const READY_AT = new Date("2026-08-05T10:00:00Z");

const feedbackRow = (overrides: Record<string, unknown> = {}) =>
  ({
    id: "f1",
    ready_at: READY_AT,
    kindness_score: 70,
    initiative_score: 70,
    empathy_score: 70,
    question_link_score: 70,
    metrics: [],
    conversation_summary: "요약",
    conversation: {
      mission: { category: "짧은 대화", difficulty: 2 },
      mission_setup: { environment: "school", partner_role: "senior" },
    },
    ...overrides,
  }) as never;

const llmSummary = {
  summary: "질문은 잘 하지만 답변을 이어받는 부분이 아쉬워요.",
  strengths: ["먼저 인사를 건넴"],
  improvements: ["상대 답변에 되묻기"],
  suggestedDifficulty: 2,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockedRepo.findGrowthProfile.mockResolvedValue(null as never);
  mockedRepo.findReadyFeedbacksAfterCursor.mockResolvedValue([feedbackRow()] as never);
  mockedRepo.findRecentReadyFeedbacks.mockResolvedValue([feedbackRow()] as never);
  mockedRepo.upsertGrowthProfile.mockResolvedValue({} as never);
  mockedSummary.buildSummaryPromptInput.mockReturnValue({});
  mockedSummary.generateGrowthSummary.mockResolvedValue(llmSummary as never);
});

describe("refreshGrowthProfile", () => {
  it("커서가 없으면(첫 갱신) 조건 없이 전체를 읽는다", async () => {
    await refreshGrowthProfile("u1");

    const [, cursor] = mockedRepo.findReadyFeedbacksAfterCursor.mock.calls[0];
    expect(cursor).toBeNull();
  });

  it("커서가 있으면 (ready_at, id)로 그 뒤만 읽는다", async () => {
    mockedRepo.findGrowthProfile.mockResolvedValue({
      last_reflected_at: READY_AT,
      last_feedback_id: "f0",
      reflected_feedback_count: 2,
    } as never);

    await refreshGrowthProfile("u1");

    const [, cursor] = mockedRepo.findReadyFeedbacksAfterCursor.mock.calls[0];
    expect(cursor).toEqual({ readyAt: READY_AT, feedbackId: "f0" });
  });

  // 두 값 중 하나라도 비면 비교식이 NULL이 되어 한 건도 걸리지 않는다.
  // 그런 프로필은 커서가 없는 것으로 보고 전체를 다시 읽어야 한다.
  it("커서 컬럼이 한쪽만 채워져 있으면 커서 없이 읽는다", async () => {
    mockedRepo.findGrowthProfile.mockResolvedValue({
      last_reflected_at: READY_AT,
      last_feedback_id: null,
      reflected_feedback_count: 2,
    } as never);

    await refreshGrowthProfile("u1");

    const [, cursor] = mockedRepo.findReadyFeedbacksAfterCursor.mock.calls[0];
    expect(cursor).toBeNull();
  });

  it("새로 반영할 피드백이 없으면 아무 것도 쓰지 않는다", async () => {
    mockedRepo.findReadyFeedbacksAfterCursor.mockResolvedValue([] as never);

    await refreshGrowthProfile("u1");

    expect(mockedRepo.upsertGrowthProfile).not.toHaveBeenCalled();
    expect(mockedSummary.generateGrowthSummary).not.toHaveBeenCalled();
  });

  it("이번에 읽은 마지막 행으로 커서를 전진시킨다", async () => {
    mockedRepo.findReadyFeedbacksAfterCursor.mockResolvedValue([
      feedbackRow({ id: "f1" }),
      feedbackRow({ id: "f2", ready_at: new Date("2026-08-06T10:00:00Z") }),
    ] as never);

    await refreshGrowthProfile("u1");

    const [, data] = mockedRepo.upsertGrowthProfile.mock.calls[0];
    expect(data.lastFeedbackId).toBe("f2");
    expect(data.lastReflectedAt).toEqual(new Date("2026-08-06T10:00:00Z"));
  });

  it("반영 건수를 기존 값에 누적한다", async () => {
    mockedRepo.findGrowthProfile.mockResolvedValue({
      last_reflected_at: READY_AT,
      last_feedback_id: "f0",
      reflected_feedback_count: 3,
    } as never);
    mockedRepo.findReadyFeedbacksAfterCursor.mockResolvedValue([
      feedbackRow({ id: "f1" }),
      feedbackRow({ id: "f2" }),
    ] as never);

    await refreshGrowthProfile("u1");

    const [, data] = mockedRepo.upsertGrowthProfile.mock.calls[0];
    expect(data.reflectedFeedbackCount).toBe(5);
  });

  it("LLM 요약 결과를 프로필에 담는다", async () => {
    await refreshGrowthProfile("u1");

    const [userId, data] = mockedRepo.upsertGrowthProfile.mock.calls[0];
    expect(userId).toBe("u1");
    expect(data.summary).toBe(llmSummary.summary);
    expect(data.strengths).toEqual(llmSummary.strengths);
    expect(data.suggestedDifficulty).toBe(2);
  });

  // 여기서 통째로 중단하면 커서가 멈춰 다음 갱신이 같은 구간을 계속 다시 읽는다.
  it("LLM 요약이 실패해도 숫자 집계와 커서는 갱신하고 서술만 기존 값을 유지한다", async () => {
    mockedRepo.findGrowthProfile.mockResolvedValue({
      last_reflected_at: null,
      last_feedback_id: null,
      reflected_feedback_count: 0,
      summary: "기존 요약",
      strengths: ["기존 강점"],
      improvements: [],
      suggested_difficulty: 3,
    } as never);
    mockedSummary.generateGrowthSummary.mockResolvedValue(null as never);

    await refreshGrowthProfile("u1");

    const [, data] = mockedRepo.upsertGrowthProfile.mock.calls[0];
    expect(data.summary).toBe("기존 요약");
    expect(data.strengths).toEqual(["기존 강점"]);
    expect(data.suggestedDifficulty).toBe(3);
    expect(data.metricAverages).not.toBeNull(); // 숫자 집계는 갱신됨
    expect(data.lastFeedbackId).toBe("f1"); // 커서도 전진
  });

  // 호출부(피드백 생성)는 사용자가 기다리는 응답이라 여기서 던지면 안 된다.
  it("도중에 예외가 나도 던지지 않는다", async () => {
    mockedRepo.findReadyFeedbacksAfterCursor.mockRejectedValue(new Error("db down"));

    await expect(refreshGrowthProfile("u1")).resolves.toBeUndefined();
    expect(mockedRepo.upsertGrowthProfile).not.toHaveBeenCalled();
  });
});

describe("getGrowthProfileForRecommendation", () => {
  it("프로필이 없으면 null을 반환한다", async () => {
    mockedRepo.findGrowthProfile.mockResolvedValue(null as never);
    await expect(getGrowthProfileForRecommendation("u1")).resolves.toBeNull();
  });

  // 1건짜리 요약은 그날의 컨디션을 사용자의 성향으로 굳힐 수 있다.
  it("반영된 피드백이 최소 건수 미만이면 null을 반환한다", async () => {
    mockedRepo.findGrowthProfile.mockResolvedValue({
      reflected_feedback_count: 1,
      summary: "요약",
    } as never);

    await expect(getGrowthProfileForRecommendation("u1")).resolves.toBeNull();
  });

  it("표본이 충분하면 프로필을 반환한다", async () => {
    mockedRepo.findGrowthProfile.mockResolvedValue({
      reflected_feedback_count: 2,
      summary: "요약",
      strengths: ["강점"],
      improvements: ["개선점"],
      struggle_situations: [{ environment: "school", partnerRole: "senior", category: "c" }],
      metric_averages: { kindness: { avg: 70, trend: "flat" } },
      suggested_difficulty: 2,
    } as never);

    const result = await getGrowthProfileForRecommendation("u1");

    expect(result).toMatchObject({
      summary: "요약",
      strengths: ["강점"],
      suggestedDifficulty: 2,
      reflectedFeedbackCount: 2,
    });
    expect(result?.struggleSituations).toHaveLength(1);
  });

  // Json 컬럼이라 형식이 깨질 수 있다. 추천이 그것 때문에 죽으면 안 된다.
  it("Json 컬럼 형식이 깨져 있어도 빈 배열로 넘어간다", async () => {
    mockedRepo.findGrowthProfile.mockResolvedValue({
      reflected_feedback_count: 2,
      summary: null,
      strengths: "깨진 값",
      improvements: null,
      struggle_situations: "깨진 값",
      metric_averages: null,
      suggested_difficulty: null,
    } as never);

    const result = await getGrowthProfileForRecommendation("u1");

    expect(result?.strengths).toEqual([]);
    expect(result?.struggleSituations).toEqual([]);
  });

  // 성장 프로필은 추천을 거들 뿐이라, 없으면 예전 경로로 추천하면 된다.
  it("조회가 실패하면 null을 반환하고 던지지 않는다", async () => {
    mockedRepo.findGrowthProfile.mockRejectedValue(new Error("db down"));
    await expect(getGrowthProfileForRecommendation("u1")).resolves.toBeNull();
  });
});

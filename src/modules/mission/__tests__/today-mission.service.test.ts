import { Prisma } from "@prisma/client";
import {
  InvalidMissionDateError,
  MissionRefreshLimitExceededError,
} from "../errors/mission.error";
import * as repository from "../repositories/mission.repository";
import * as recommendationService from "../services/recommendation.service";
import { getTodayMission } from "../services/mission.service";
import { MISSION_REFRESH_LIMIT } from "../dtos/mission.constants";
import { todayInKst } from "../../../shared/utils/date";

// 이 파일은 GET /missions/today(getTodayMission)의 일일 캐시·새로고침 제한만 다룬다.
jest.mock("../repositories/mission.repository");
jest.mock("../services/recommendation.service");

const mockedRepo = jest.mocked(repository);
const mockedRecommend = jest.mocked(recommendationService);

// 시각을 고정한다. 고정하지 않으면 TODAY는 모듈 로드 시점의 KST 날짜인데
// getTodayMission 내부는 실행 시점에 todayInKst()를 다시 부른다 — 그 사이 KST 자정을
// 넘기면 date를 생략한 테스트가 하루 어긋나 간헐적으로 실패한다.
const FIXED_NOW = new Date("2026-08-04T03:00:00.000Z"); // KST 정오 — 자정 경계에서 멀다
const TODAY = todayInKst(FIXED_NOW);

beforeAll(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "queueMicrotask", "setImmediate"] });
  jest.setSystemTime(FIXED_NOW);
});
afterAll(() => jest.useRealTimers());

const recommended = (overrides: Record<string, unknown> = {}) => ({
  missionId: null,
  title: "카페에서 음료 추천 물어보기",
  description: "설명",
  difficulty: 2,
  estimatedMinutes: 10,
  rewardXp: 20,
  category: "짧은 대화",
  reason: "이유",
  expectedEffect: "효과",
  preparationTip: "미리 메뉴판을 살펴보면 대화가 수월해요.",
  caution: "직원이 바빠 보이면 짧게 물어보세요.",
  source: "llm" as const,
  setupGuideline: null,
  recommendationLogId: "log1",
  ...overrides,
});

// Recommendation_Logs 한 행. recommended_mission에는 추천 스냅샷 JSON이 들어간다.
const buildLog = (overrides: Record<string, unknown> = {}) =>
  ({
    id: "log1",
    user_id: "u1",
    created_mission_id: "m-existing",
    recommended_mission: recommended({ missionId: null }),
    ...overrides,
  }) as never;

beforeEach(() => {
  jest.clearAllMocks();
  mockedRepo.findUserPersonalityType.mockResolvedValue("introvert");
  mockedRepo.findSavedMission.mockResolvedValue(null as never);
  mockedRepo.findLatestRecommendationLogByDate.mockResolvedValue(null as never);
  mockedRepo.countRecommendationLogsByDate.mockResolvedValue(0);
  mockedRepo.reserveRecommendationLogSlot.mockResolvedValue({ id: "log1" } as never);
  mockedRepo.createMissionFromRecommendation.mockResolvedValue({ id: "m-new" } as never);
  mockedRepo.createMissionForRecommendationLog.mockResolvedValue("m-new");
  mockedRepo.markRecommendationLogMissionCreated.mockResolvedValue({} as never);
  // #245 — 기본값은 "재사용할 미션 없음"(새로 만든다). 재사용 테스트에서만 덮어쓴다.
  mockedRepo.findMissionByTitleForReuse.mockResolvedValue(null);
  mockedRecommend.recommendMission.mockResolvedValue(recommended());
});

describe("getTodayMission — 일일 캐시", () => {
  it("오늘 추천이 없으면 새로 뽑고 실제 Missions 행까지 만든다", async () => {
    const result = await getTodayMission("u1", { date: TODAY });

    expect(mockedRecommend.recommendMission).toHaveBeenCalledTimes(1);
    expect(mockedRepo.createMissionForRecommendationLog).toHaveBeenCalledTimes(1);
    // 추천 시점에 저장하므로 missionId가 null로 나가지 않는다.
    expect(result.missionId).toBe("m-new");
    expect(result.isNew).toBe(true);
  });

  it("미션 생성과 백링크를 예약 로그 기준으로 한 번에 처리한다", async () => {
    // 생성과 백링크가 나뉘어 있으면 병렬 요청이 각자 미션을 만들고 백링크를 덮어써,
    // 아무도 가리키지 않는 미션이 목록에 쌓인다. 로그 id를 넘겨 원자적으로 처리한다.
    await getTodayMission("u1", { date: TODAY });

    expect(mockedRepo.createMissionForRecommendationLog).toHaveBeenCalledWith(
      "log1",
      expect.objectContaining({ createdByUserId: "u1", creatorPersonalityType: "introvert" })
    );
  });

  it("오늘 추천이 이미 있으면 LLM을 다시 부르지 않고 그대로 돌려준다", async () => {
    mockedRepo.findLatestRecommendationLogByDate.mockResolvedValue(buildLog());
    mockedRepo.countRecommendationLogsByDate.mockResolvedValue(1);

    const result = await getTodayMission("u1", { date: TODAY });

    expect(mockedRecommend.recommendMission).not.toHaveBeenCalled();
    expect(mockedRepo.createMissionForRecommendationLog).not.toHaveBeenCalled();
    expect(result.missionId).toBe("m-existing");
    expect(result.isNew).toBe(false);
  });

  it("template 추천은 이미 실제 미션이라 새로 만들지 않는다", async () => {
    mockedRecommend.recommendMission.mockResolvedValue(
      recommended({ missionId: "m-template", source: "template" })
    );

    const result = await getTodayMission("u1", { date: TODAY });

    expect(mockedRepo.createMissionForRecommendationLog).not.toHaveBeenCalled();
    // template 추천은 이미 실제 미션이므로 백링크만 남긴다.
    expect(mockedRepo.markRecommendationLogMissionCreated).toHaveBeenCalledWith("log1", "m-template");
    expect(result.missionId).toBe("m-template");
  });

  it("캐시된 추천에 실제 미션이 없으면 LLM 없이 그 자리에서 만들어 백링크한다", async () => {
    // 이 기능 이전에 쌓인 로그, 또는 미션 저장이 중간에 끊긴 경우.
    // 여기서 복구하지 않으면 홈 카드가 하루 종일 비고 대화도 시작할 수 없다.
    mockedRepo.findLatestRecommendationLogByDate.mockResolvedValue(
      buildLog({ created_mission_id: null })
    );
    mockedRepo.countRecommendationLogsByDate.mockResolvedValue(1);

    const result = await getTodayMission("u1", { date: TODAY });

    expect(mockedRecommend.recommendMission).not.toHaveBeenCalled(); // 추천을 다시 뽑지는 않는다
    expect(mockedRepo.createMissionForRecommendationLog).toHaveBeenCalledWith(
      "log1",
      expect.objectContaining({ createdByUserId: "u1" })
    );
    expect(result.missionId).toBe("m-new");
    expect(result.isNew).toBe(false); // 새 추천이 아니라 기존 추천의 복구다
  });

  it("캐시된 로그의 JSON이 깨져 있으면 캐시를 포기하고 새로 뽑는다", async () => {
    mockedRepo.findLatestRecommendationLogByDate.mockResolvedValue(
      buildLog({ recommended_mission: { unexpected: "shape" } })
    );
    mockedRepo.countRecommendationLogsByDate.mockResolvedValue(1);

    const result = await getTodayMission("u1", { date: TODAY });

    expect(mockedRecommend.recommendMission).toHaveBeenCalledTimes(1);
    expect(result.isNew).toBe(true);
  });
});

// #245 — LLM이 서로 다른 요청(다른 유저·다른 날)에서 같은 제목의 미션을 반복 생성해
// 완전히 동일한 미션이 목록에 중복으로 쌓이던 문제. 같은 제목(+같은 성향)의 미션이 이미
// 있으면 새로 만들지 않고 재사용해야 한다.
describe("getTodayMission — 같은 제목의 AI 미션 재사용(#245)", () => {
  it("같은 제목·같은 성향의 미션이 이미 있으면 새로 만들지 않고 재사용한다", async () => {
    mockedRepo.findMissionByTitleForReuse.mockResolvedValue({ id: "m-reused" } as never);

    const result = await getTodayMission("u1", { date: TODAY });

    expect(mockedRepo.findMissionByTitleForReuse).toHaveBeenCalledWith(
      "카페에서 음료 추천 물어보기",
      "introvert"
    );
    expect(mockedRepo.createMissionForRecommendationLog).not.toHaveBeenCalled();
    expect(mockedRepo.createMissionFromRecommendation).not.toHaveBeenCalled();
    expect(mockedRepo.markRecommendationLogMissionCreated).toHaveBeenCalledWith("log1", "m-reused");
    expect(result.missionId).toBe("m-reused");
  });

  it("같은 제목의 미션이 없으면 평소대로 새로 만든다", async () => {
    mockedRepo.findMissionByTitleForReuse.mockResolvedValue(null);

    const result = await getTodayMission("u1", { date: TODAY });

    expect(mockedRepo.createMissionForRecommendationLog).toHaveBeenCalledTimes(1);
    expect(result.missionId).toBe("m-new");
  });
});

describe("getTodayMission — 새로고침 제한", () => {
  it("refresh=true면 오늘 추천이 있어도 새로 뽑는다", async () => {
    mockedRepo.findLatestRecommendationLogByDate.mockResolvedValue(buildLog());
    mockedRepo.countRecommendationLogsByDate.mockResolvedValue(1);

    const result = await getTodayMission("u1", { date: TODAY, refresh: true });

    expect(mockedRecommend.recommendMission).toHaveBeenCalledTimes(1);
    expect(result.isNew).toBe(true);
    expect(result.refreshCount).toBe(1); // 로그 2건 = 새로고침 1회
  });

  it("그날 첫 생성은 새로고침으로 세지 않는다", async () => {
    const result = await getTodayMission("u1", { date: TODAY });

    expect(result.refreshCount).toBe(0);
    expect(result.remainingRefreshes).toBe(MISSION_REFRESH_LIMIT);
  });

  it("새로고침 횟수를 모두 쓰면 429를 던지고 LLM을 부르지 않는다", async () => {
    mockedRepo.findLatestRecommendationLogByDate.mockResolvedValue(buildLog());
    // 첫 생성 1건 + 새로고침 3건 = 4건이면 한도 소진
    mockedRepo.countRecommendationLogsByDate.mockResolvedValue(1 + MISSION_REFRESH_LIMIT);

    await expect(getTodayMission("u1", { date: TODAY, refresh: true })).rejects.toBeInstanceOf(
      MissionRefreshLimitExceededError
    );
    expect(mockedRecommend.recommendMission).not.toHaveBeenCalled();
  });

  it("LLM을 부르기 전에 슬롯을 먼저 선점한다", async () => {
    mockedRepo.findLatestRecommendationLogByDate.mockResolvedValue(buildLog());
    mockedRepo.countRecommendationLogsByDate.mockResolvedValue(1);

    await getTodayMission("u1", { date: TODAY, refresh: true });

    // 예약 순번은 현재 로그 건수(=다음 슬롯). 이 행의 id가 그대로 추천에 넘어간다.
    expect(mockedRepo.reserveRecommendationLogSlot).toHaveBeenCalledWith("u1", expect.any(Date), 1);
    expect(mockedRecommend.recommendMission).toHaveBeenCalledWith("u1", "log1");
  });

  it("동시 요청이 같은 슬롯을 가져가면(P2002) 다음 순번으로 다시 잡는다", async () => {
    mockedRepo.findLatestRecommendationLogByDate.mockResolvedValue(buildLog());
    mockedRepo.countRecommendationLogsByDate
      .mockResolvedValueOnce(1) // 최초 판단 시점
      .mockResolvedValue(2); // 경합에서 진 뒤 다시 읽은 건수
    mockedRepo.reserveRecommendationLogSlot
      .mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError("unique", {
          code: "P2002",
          clientVersion: "5.22.0",
        })
      )
      .mockResolvedValue({ id: "log2" } as never);

    const result = await getTodayMission("u1", { date: TODAY, refresh: true });

    expect(mockedRepo.reserveRecommendationLogSlot).toHaveBeenNthCalledWith(
      2,
      "u1",
      expect.any(Date),
      2
    );
    expect(result.isNew).toBe(true);
  });

  it("경합에 밀려 순번이 한도를 넘으면 LLM을 부르지 않고 429를 던진다", async () => {
    mockedRepo.findLatestRecommendationLogByDate.mockResolvedValue(buildLog());
    mockedRepo.countRecommendationLogsByDate
      .mockResolvedValueOnce(1)
      .mockResolvedValue(1 + MISSION_REFRESH_LIMIT); // 그 사이 다른 요청들이 한도를 채움
    mockedRepo.reserveRecommendationLogSlot.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("unique", {
        code: "P2002",
        clientVersion: "5.22.0",
      })
    );

    await expect(getTodayMission("u1", { date: TODAY, refresh: true })).rejects.toBeInstanceOf(
      MissionRefreshLimitExceededError
    );
    expect(mockedRecommend.recommendMission).not.toHaveBeenCalled();
  });

  it("한도를 다 썼어도 refresh 없이 조회하면 캐시된 추천을 정상 반환한다", async () => {
    mockedRepo.findLatestRecommendationLogByDate.mockResolvedValue(buildLog());
    mockedRepo.countRecommendationLogsByDate.mockResolvedValue(1 + MISSION_REFRESH_LIMIT);

    const result = await getTodayMission("u1", { date: TODAY });

    expect(result.missionId).toBe("m-existing");
    expect(result.remainingRefreshes).toBe(0);
  });

  // #192 — 결과 기록(updateRecommendationLog)이 실패해 슬롯은 예약됐지만 recommended_mission이
  // 비어 있는 로그가 남으면, 이전엔 이 손상된 캐시를 복구하려는 일반 조회가 reserveRefreshSlot을
  // 타면서 한도 체크에 걸려 429가 났다. 유저는 재추천을 요청한 적이 없으므로, 한도를 이미
  // 다 쓴 상태여도 429 없이 그 자리에서 새로 만들어 내려줘야 한다.
  it("한도를 다 쓴 상태에서 캐시가 손상돼도 429 없이 새로 뽑아 반환한다", async () => {
    mockedRepo.findLatestRecommendationLogByDate.mockResolvedValue(
      buildLog({ recommended_mission: null })
    );
    mockedRepo.countRecommendationLogsByDate.mockResolvedValue(1 + MISSION_REFRESH_LIMIT);

    const result = await getTodayMission("u1", { date: TODAY });

    expect(mockedRecommend.recommendMission).toHaveBeenCalledTimes(1);
    expect(result.isNew).toBe(true);
  });

  it("손상된 캐시 복구는 명시적 refresh가 아니므로 슬롯 예약 시 한도를 체크하지 않는다", async () => {
    mockedRepo.findLatestRecommendationLogByDate.mockResolvedValue(
      buildLog({ recommended_mission: null })
    );
    mockedRepo.countRecommendationLogsByDate.mockResolvedValue(1 + MISSION_REFRESH_LIMIT);

    await getTodayMission("u1", { date: TODAY });

    // 한도를 넘는 슬롯 번호로 예약을 시도해도(=checkLimit이었다면 429) 그대로 통과해야 한다.
    expect(mockedRepo.reserveRecommendationLogSlot).toHaveBeenCalledWith(
      "u1",
      expect.any(Date),
      1 + MISSION_REFRESH_LIMIT
    );
  });

  // 코드래빗 리뷰(PR #196): 손상된 캐시를 복구할 때 새로 예약한 슬롯 자체를 refreshCount에
  // 반영하면, 유저가 요청하지 않은 복구가 새로고침을 "쓴 것"처럼 보이게 만든다.
  it("손상된 캐시 복구는 refreshCount를 증가시키지 않는다", async () => {
    mockedRepo.findLatestRecommendationLogByDate.mockResolvedValue(
      buildLog({ recommended_mission: null })
    );
    // 복구 전 로그 2건(첫 생성 1 + 새로고침 1) = 복구 전 refreshCount는 1이어야 한다.
    mockedRepo.countRecommendationLogsByDate.mockResolvedValue(2);

    const result = await getTodayMission("u1", { date: TODAY });

    // 복구용 슬롯(3번째 로그)이 추가로 예약되지만, 그 슬롯은 refreshCount 계산에서 제외된다.
    expect(result.refreshCount).toBe(1);
  });
});

describe("getTodayMission — setupGuideline (#152)", () => {
  it("추천된 미션의 setup_guideline을 별도 조회해 응답에 포함한다", async () => {
    const rawGuideline = {
      defaults: {
        environment: "community",
        partnerRole: "other",
        intimacyLevel: 2,
        formalityLevel: 4,
        partnerGender: "female",
        partnerAgeGroup: "twenties",
      },
      disabled: {
        environment: [],
        partnerRole: [],
        intimacyLevel: [],
        formalityLevel: [],
        partnerGender: [],
        partnerAgeGroup: [],
      },
      note: null,
      recommendedTopics: [],
      tags: [],
    };
    mockedRepo.findMissionSetupGuideline.mockResolvedValue({ setup_guideline: rawGuideline } as never);

    const result = await getTodayMission("u1", { date: TODAY });

    expect(mockedRepo.findMissionSetupGuideline).toHaveBeenCalledWith("m-new");
    expect(result.setupGuideline).toEqual(rawGuideline);
  });

  it("setup_guideline이 없으면 null을 응답한다", async () => {
    mockedRepo.findMissionSetupGuideline.mockResolvedValue({ setup_guideline: null } as never);

    const result = await getTodayMission("u1", { date: TODAY });

    expect(result.setupGuideline).toBeNull();
  });
});

describe("getTodayMission — 날짜 검증", () => {
  it("date를 생략하면 서버(KST) 기준 오늘을 쓴다", async () => {
    const result = await getTodayMission("u1");

    expect(result.date).toBe(TODAY);
  });

  it("서버 기준 오늘과 하루 넘게 차이 나는 날짜는 거부한다(새로고침 제한 우회 방지)", async () => {
    await expect(getTodayMission("u1", { date: "2020-01-01" })).rejects.toBeInstanceOf(
      InvalidMissionDateError
    );
    expect(mockedRecommend.recommendMission).not.toHaveBeenCalled();
  });
});

jest.mock("../../../config/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock("../repositories/report.repository");

import { Prisma } from "@prisma/client";
import * as reportRepository from "../repositories/report.repository";
import { generateMissingWeeklyReports } from "../services/weekly-compare.service";
import { WeeklyCompareReportDto } from "../dtos/report.dto";

const mockedRepo = jest.mocked(reportRepository);

// 특정 주차의 "활동" 조회 결과(countCompletedMissionRecordsInRange/sumXpAmountInRange/
// findFeedbackScoresInRange)를 준비한다. feedbackScore가 있으면 그 주는 "활동 있음"이 된다.
const mockWeekActivity = (score: number | null) => {
  mockedRepo.countCompletedMissionRecordsInRange.mockResolvedValueOnce(score !== null ? 1 : 0);
  mockedRepo.sumXpAmountInRange.mockResolvedValueOnce(score !== null ? 10 : 0);
  mockedRepo.findFeedbackScoresInRange.mockResolvedValueOnce(
    score !== null
      ? ([
          {
            kindness_score: score,
            initiative_score: score,
            empathy_score: score,
            question_link_score: score,
            created_at: new Date(),
          },
        ] as never)
      : ([] as never)
  );
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("generateMissingWeeklyReports", () => {
  const signupAt = new Date("2026-08-01T00:00:00.000Z");

  it("가입 후 7일이 안 지났으면 아무것도 생성하지 않는다", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-08-05T00:00:00.000Z"));

    const result = await generateMissingWeeklyReports("u1", signupAt);

    expect(result).toEqual([]);
    expect(mockedRepo.createWeeklyCompareReport).not.toHaveBeenCalled();

    jest.useRealTimers();
  });

  it("1주차가 막 끝났고 활동이 있었으면 0점 기준으로 첫 리포트를 만든다", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-08-08T00:00:00.000Z"));
    mockedRepo.findLatestWeeklyCompareReport.mockResolvedValue(null);
    mockWeekActivity(23);
    mockedRepo.createWeeklyCompareReport.mockResolvedValue({ id: "r1" } as never);

    const result = await generateMissingWeeklyReports("u1", signupAt);

    expect(result).toHaveLength(1);
    expect(result[0].weekIndex).toBe(1);
    const data = result[0].data as WeeklyCompareReportDto;
    expect(data.overallScoreChange).toEqual({ from: 0, to: 23, delta: 23 });

    jest.useRealTimers();
  });

  it("이미 최신 주차까지 생성돼 있으면 아무것도 만들지 않는다", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-08-08T00:00:00.000Z"));
    mockedRepo.findLatestWeeklyCompareReport.mockResolvedValue({
      week_index: 1,
      data: { thisWeek: { completedMissionCount: 1, xpEarned: 10, metrics: { kindness: 23, initiative: 23, empathy: 23, questionLink: 23 } } },
    } as never);

    const result = await generateMissingWeeklyReports("u1", signupAt);

    expect(result).toEqual([]);
    expect(mockedRepo.createWeeklyCompareReport).not.toHaveBeenCalled();

    jest.useRealTimers();
  });

  it("몇 주를 건너뛰어도 활동 없는 주는 건너뛰고, 활동 있는 주끼리만 이어서 비교한다", async () => {
    // 1주차(23점) 저장돼 있고, 2·3주차엔 활동 없음, 4주차에 활동(24점) — 지금은 4주차까지 완결된 시점.
    jest.useFakeTimers().setSystemTime(new Date("2026-08-29T00:00:00.000Z")); // signupAt + 28일 = 4주 완결

    mockedRepo.findLatestWeeklyCompareReport.mockResolvedValue({
      week_index: 1,
      data: {
        thisWeek: {
          completedMissionCount: 1,
          xpEarned: 10,
          metrics: { kindness: 23, initiative: 23, empathy: 23, questionLink: 23 },
        },
      },
    } as never);

    mockWeekActivity(null); // 2주차: 활동 없음
    mockWeekActivity(null); // 3주차: 활동 없음
    mockWeekActivity(24); // 4주차: 활동 있음
    mockedRepo.createWeeklyCompareReport.mockResolvedValue({ id: "r4" } as never);

    const result = await generateMissingWeeklyReports("u1", signupAt);

    // 2·3주차는 리포트가 생성되지 않고, 4주차 하나만 1주차(23점)와 비교되어 생성된다.
    expect(mockedRepo.createWeeklyCompareReport).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(1);
    expect(result[0].weekIndex).toBe(4);
    const data = result[0].data as WeeklyCompareReportDto;
    expect(data.overallScoreChange).toEqual({ from: 23, to: 24, delta: 1 });

    jest.useRealTimers();
  });

  it("동시 생성 경합(P2002)이 나면 조용히 건너뛴다", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-08-08T00:00:00.000Z"));
    mockedRepo.findLatestWeeklyCompareReport.mockResolvedValue(null);
    mockWeekActivity(23);
    mockedRepo.createWeeklyCompareReport.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "5.22.0" })
    );

    const result = await generateMissingWeeklyReports("u1", signupAt);

    expect(result).toEqual([]);

    jest.useRealTimers();
  });

  it("한 호출에서 여러 주차를 따라잡는 중 앞 주차가 P2002로 지면, 승자 값으로 다음 주차의 from을 잡는다", async () => {
    // 1·2주차 둘 다 활동이 있고, 1주차는 다른 요청이 먼저 만들어 P2002가 난다. 이때 2주차의
    // from은 (버그가 있다면) 가입 직후 0으로 잘못 잡히지만, 승자를 다시 읽으면 1주차의
    // 실제 값(23점)으로 정확히 이어져야 한다.
    jest.useFakeTimers().setSystemTime(new Date("2026-08-15T00:00:00.000Z")); // signupAt + 14일 = 2주 완결
    mockedRepo.findLatestWeeklyCompareReport.mockResolvedValue(null);

    mockWeekActivity(23); // 1주차: 활동 있음 (경합에서 짐)
    mockWeekActivity(30); // 2주차: 활동 있음

    mockedRepo.createWeeklyCompareReport
      .mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "5.22.0" })
      )
      .mockResolvedValueOnce({ id: "r2" } as never);

    // 경합에 진 뒤 1주차를 다시 읽으면, 승자가 이미 저장해 둔 실제 값(23점)이 나온다.
    mockedRepo.findWeeklyCompareReportByWeekIndex.mockResolvedValue({
      week_index: 1,
      data: {
        thisWeek: {
          completedMissionCount: 1,
          xpEarned: 10,
          metrics: { kindness: 23, initiative: 23, empathy: 23, questionLink: 23 },
        },
      },
    } as never);

    const result = await generateMissingWeeklyReports("u1", signupAt);

    expect(mockedRepo.findWeeklyCompareReportByWeekIndex).toHaveBeenCalledWith("u1", 1);
    expect(result).toHaveLength(1);
    expect(result[0].weekIndex).toBe(2);
    const data = result[0].data as WeeklyCompareReportDto;
    // 버그가 있었다면 from이 0(가입 직후 기준값)으로 나왔을 것 — 1주차의 실제 값 23이어야 한다.
    expect(data.overallScoreChange).toEqual({ from: 23, to: 30, delta: 7 });

    jest.useRealTimers();
  });
});

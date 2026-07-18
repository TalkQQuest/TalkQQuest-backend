import { NotFoundError } from "../../../shared/errors/common.error";
import * as repository from "../repositories/xp.repository";
import { calculateNextLevelXp } from "../services/level.service";
import { getXpHistory, getXpSummary } from "../services/xp.service";

// Prisma 접근 계층을 통째로 mock한다 (DB 없이 서비스 로직만 검증).
jest.mock("../repositories/xp.repository");
const mockedRepo = jest.mocked(repository);

const sumResult = (amount: number | null) => ({ _sum: { amount } }) as never;

const historyRow = (overrides: Record<string, unknown> = {}) =>
  ({
    id: "h1",
    amount: 20,
    reason: "미션 완료",
    reference_id: "r1",
    reference_type: "mission_record",
    created_at: new Date("2026-07-01T00:00:00Z"),
    ...overrides,
  }) as never;

beforeEach(() => {
  jest.clearAllMocks();
  mockedRepo.sumXpAmountByUserId.mockResolvedValue(sumResult(0));
  mockedRepo.findXpHistoryByUserId.mockResolvedValue([] as never);
  mockedRepo.countXpHistoryByUserId.mockResolvedValue(0 as never);
});

describe("calculateNextLevelXp", () => {
  it("레벨에 비례해 필요 XP를 계산한다", () => {
    expect(calculateNextLevelXp(1)).toBe(100);
    expect(calculateNextLevelXp(3)).toBe(300);
  });
});

describe("getXpSummary", () => {
  it("프로필이 없으면 NotFoundError를 던진다", async () => {
    mockedRepo.findProfileXpByUserId.mockResolvedValue(null as never);
    await expect(getXpSummary("u1")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("레벨/현재 진행도/다음 레벨 필요 XP/누적 XP를 반환한다", async () => {
    mockedRepo.findProfileXpByUserId.mockResolvedValue({ level: 3, xp: 120 } as never);
    mockedRepo.sumXpAmountByUserId.mockResolvedValue(sumResult(1520));

    const result = await getXpSummary("u1");

    expect(result).toEqual({
      level: 3,
      currentXp: 120, // 레벨 내 진행도
      nextLevelXp: 300, // calculateNextLevelXp(3)
      totalXp: 1520, // XP_History 합계 (누적)
    });
  });

  it("nextLevelXp는 레벨업 판정과 동일한 공식을 쓴다", async () => {
    mockedRepo.findProfileXpByUserId.mockResolvedValue({ level: 7, xp: 0 } as never);

    const result = await getXpSummary("u1");

    expect(result.nextLevelXp).toBe(calculateNextLevelXp(7));
  });

  it("지급 이력이 없으면(_sum.amount=null) totalXp는 0이다", async () => {
    mockedRepo.findProfileXpByUserId.mockResolvedValue({ level: 1, xp: 0 } as never);
    mockedRepo.sumXpAmountByUserId.mockResolvedValue(sumResult(null));

    const result = await getXpSummary("u1");

    expect(result.totalXp).toBe(0);
  });

  it("누적 XP는 현재 진행도와 별개다 (레벨업으로 xp가 차감돼도 누적은 유지)", async () => {
    // 레벨 2인데 레벨 내 진행도는 20뿐이지만, 누적으로는 120을 벌었던 상황
    mockedRepo.findProfileXpByUserId.mockResolvedValue({ level: 2, xp: 20 } as never);
    mockedRepo.sumXpAmountByUserId.mockResolvedValue(sumResult(120));

    const result = await getXpSummary("u1");

    expect(result.currentXp).toBe(20);
    expect(result.totalXp).toBe(120);
  });
});

describe("getXpHistory", () => {
  it("내역을 응답 형태로 매핑한다 (snake_case → camelCase, 날짜는 ISO)", async () => {
    mockedRepo.findXpHistoryByUserId.mockResolvedValue([historyRow()] as never);
    mockedRepo.countXpHistoryByUserId.mockResolvedValue(1 as never);

    const result = await getXpHistory("u1", {});

    expect(result.items[0]).toEqual({
      id: "h1",
      amount: 20,
      reason: "미션 완료",
      referenceId: "r1",
      referenceType: "mission_record",
      createdAt: "2026-07-01T00:00:00.000Z",
    });
  });

  it("기본 페이지네이션은 1페이지 10건이다", async () => {
    await getXpHistory("u1", {});

    expect(mockedRepo.findXpHistoryByUserId).toHaveBeenCalledWith("u1", 1, 10);
  });

  it("page/size를 그대로 전달하고 pageInfo를 계산한다", async () => {
    mockedRepo.countXpHistoryByUserId.mockResolvedValue(25 as never);

    const result = await getXpHistory("u1", { page: 2, size: 10 });

    expect(mockedRepo.findXpHistoryByUserId).toHaveBeenCalledWith("u1", 2, 10);
    expect(result.pageInfo).toEqual({ currentPage: 2, totalPages: 3, totalCount: 25 });
  });

  it("내역이 없어도 totalPages는 최소 1이다", async () => {
    const result = await getXpHistory("u1", {});

    expect(result.items).toEqual([]);
    expect(result.pageInfo).toEqual({ currentPage: 1, totalPages: 1, totalCount: 0 });
  });

  it("차감(음수 amount) 내역도 그대로 반환한다", async () => {
    mockedRepo.findXpHistoryByUserId.mockResolvedValue([
      historyRow({ amount: -50, reason: "관리자 차감", reference_id: null, reference_type: null }),
    ] as never);
    mockedRepo.countXpHistoryByUserId.mockResolvedValue(1 as never);

    const result = await getXpHistory("u1", {});

    expect(result.items[0].amount).toBe(-50);
    expect(result.items[0].referenceId).toBeNull();
  });
});

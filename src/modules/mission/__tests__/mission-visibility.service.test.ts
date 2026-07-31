import * as repository from "../repositories/mission.repository";
import { getMissions } from "../services/mission.service";

// 이 파일은 GET /missions의 공개 범위(템플릿 + 유사 성향 AI 미션)만 다룬다.
jest.mock("../repositories/mission.repository");

const mockedRepo = jest.mocked(repository);

const buildMission = (overrides: Record<string, unknown> = {}) =>
  ({
    id: "m1",
    title: "미션",
    category: "짧은 대화",
    difficulty: 2,
    estimated_minutes: 10,
    reward_xp: 20,
    is_template: true,
    created_by_user_id: null,
    ...overrides,
  }) as never;

beforeEach(() => {
  jest.clearAllMocks();
  mockedRepo.findUserPersonalityType.mockResolvedValue("introvert");
  mockedRepo.findMissions.mockResolvedValue([] as never);
  mockedRepo.countMissions.mockResolvedValue(0);
  mockedRepo.findSavedMissionIds.mockResolvedValue([] as never);
});

describe("getMissions — 공개 범위", () => {
  it("내 성향을 조회해 목록/카운트에 같은 visibility로 넘긴다", async () => {
    await getMissions("u1", {});

    const visibility = { userId: "u1", personalityType: "introvert", origin: undefined };
    expect(mockedRepo.findMissions).toHaveBeenCalledWith(
      expect.objectContaining({ visibility })
    );
    // 카운트가 다른 조건으로 세면 페이지 수가 어긋나므로 동일해야 한다.
    expect(mockedRepo.countMissions).toHaveBeenCalledWith(
      expect.objectContaining({ visibility })
    );
  });

  it("온보딩 전(성향 없음)이면 personalityType을 null로 넘긴다", async () => {
    mockedRepo.findUserPersonalityType.mockResolvedValue(null);

    await getMissions("u1", {});

    expect(mockedRepo.findMissions).toHaveBeenCalledWith(
      expect.objectContaining({ visibility: expect.objectContaining({ personalityType: null }) })
    );
  });

  it("origin 필터를 그대로 전달한다", async () => {
    await getMissions("u1", { origin: "ai" });

    expect(mockedRepo.findMissions).toHaveBeenCalledWith(
      expect.objectContaining({ visibility: expect.objectContaining({ origin: "ai" }) })
    );
  });

  it("템플릿 미션은 origin=template, isMine=false로 내려준다", async () => {
    mockedRepo.findMissions.mockResolvedValue([buildMission()] as never);
    mockedRepo.countMissions.mockResolvedValue(1);

    const result = await getMissions("u1", {});

    expect(result.missions[0]).toMatchObject({ origin: "template", isMine: false });
  });

  it("내가 만든 AI 미션은 origin=ai, isMine=true로 내려준다", async () => {
    mockedRepo.findMissions.mockResolvedValue([
      buildMission({ is_template: false, created_by_user_id: "u1" }),
    ] as never);
    mockedRepo.countMissions.mockResolvedValue(1);

    const result = await getMissions("u1", {});

    expect(result.missions[0]).toMatchObject({ origin: "ai", isMine: true });
  });

  it("남이 만든 AI 미션은 origin=ai, isMine=false로 내려준다", async () => {
    mockedRepo.findMissions.mockResolvedValue([
      buildMission({ is_template: false, created_by_user_id: "u2" }),
    ] as never);
    mockedRepo.countMissions.mockResolvedValue(1);

    const result = await getMissions("u1", {});

    expect(result.missions[0]).toMatchObject({ origin: "ai", isMine: false });
  });
});

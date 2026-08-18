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
  // #246 — 템플릿이 없으면(기본값) 맨 앞 끌어올리기 없이 기존 동작 그대로다.
  mockedRepo.findTemplateMissionIds.mockResolvedValue([] as never);
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

// #246 — AI 생성 미션이 계속 쌓이면서 created_at desc 정렬만으로는 템플릿 미션이 뒤로
// 밀려 안 보이는 문제. 완료 안 한 템플릿 몇 개를 1페이지 맨 앞으로 끌어올린다.
describe("getMissions — 템플릿 미션 앞으로 끌어올리기(#246)", () => {
  const templateIds = ["t1", "t2", "t3", "t4", "t5", "t6"];
  const buildTemplate = (id: string) =>
    buildMission({ id, is_template: true, created_by_user_id: null });

  beforeEach(() => {
    mockedRepo.findTemplateMissionIds.mockResolvedValue(
      templateIds.map((id) => ({ id })) as never
    );
    mockedRepo.findLatestMissionRecordsByMissionIds.mockResolvedValue([] as never);
    mockedRepo.countMissions.mockResolvedValue(20);
  });

  it("완료 안 한 템플릿이 4개보다 많으면 4개만 무작위로 앞세우고, 나머지는 제외한 채로 뒤를 채운다", async () => {
    mockedRepo.findMissionsByIds.mockImplementation(
      ((ids: string[]) => Promise.resolve(ids.map((id) => buildTemplate(id)))) as never
    );
    mockedRepo.findMissionsExcluding.mockResolvedValue([buildMission({ id: "rest1" })] as never);

    const result = await getMissions("u1", {});

    expect(mockedRepo.findMissionsByIds).toHaveBeenCalledWith(
      expect.arrayContaining([expect.any(String)])
    );
    const [frontCallIds] = mockedRepo.findMissionsByIds.mock.calls[0];
    expect(frontCallIds).toHaveLength(4);
    // 뽑힌 4개는 반드시 템플릿 후보(templateIds) 중에서 나와야 한다.
    for (const id of frontCallIds) expect(templateIds).toContain(id);

    // rest 조회는 뽑힌 4개 전부를 제외해야 한다(어느 페이지에도 다시 안 끼어들도록).
    expect(mockedRepo.findMissionsExcluding).toHaveBeenCalledWith(
      expect.objectContaining({ excludeIds: frontCallIds, skip: 0, take: 6 })
    );
    expect(result.missions).toHaveLength(5); // front 4개 + rest 1개
    expect(result.missions.slice(0, 4).every((m) => m.origin === "template")).toBe(true);
  });

  it("완료 안 한 템플릿이 4개 이하면 그 개수만큼만 앞세운다", async () => {
    mockedRepo.findLatestMissionRecordsByMissionIds.mockResolvedValue(
      templateIds.slice(2).map((id) => ({ mission_id: id, status: "completed" })) as never
    ); // t1, t2만 미완료
    mockedRepo.findMissionsByIds.mockImplementation(
      ((ids: string[]) => Promise.resolve(ids.map((id) => buildTemplate(id)))) as never
    );
    mockedRepo.findMissionsExcluding.mockResolvedValue([] as never);

    await getMissions("u1", {});

    const [frontCallIds] = mockedRepo.findMissionsByIds.mock.calls[0];
    expect(frontCallIds.sort()).toEqual(["t1", "t2"]);
  });

  it("템플릿을 전부 완료했으면 완료한 것 중 2개를 앞세운다", async () => {
    mockedRepo.findLatestMissionRecordsByMissionIds.mockResolvedValue(
      templateIds.map((id) => ({ mission_id: id, status: "completed" })) as never
    );
    mockedRepo.findMissionsByIds.mockImplementation(
      ((ids: string[]) => Promise.resolve(ids.map((id) => buildTemplate(id)))) as never
    );
    mockedRepo.findMissionsExcluding.mockResolvedValue([] as never);

    await getMissions("u1", {});

    const [frontCallIds] = mockedRepo.findMissionsByIds.mock.calls[0];
    expect(frontCallIds).toHaveLength(2);
    for (const id of frontCallIds) expect(templateIds).toContain(id);
  });

  it("같은 유저가 같은 날 다시 조회하면 앞세우는 템플릿 조합이 그대로 유지된다(페이지 정합성)", async () => {
    mockedRepo.findMissionsByIds.mockImplementation(
      ((ids: string[]) => Promise.resolve(ids.map((id) => buildTemplate(id)))) as never
    );
    mockedRepo.findMissionsExcluding.mockResolvedValue([] as never);

    await getMissions("u1", {});
    const first = mockedRepo.findMissionsByIds.mock.calls[0][0];

    mockedRepo.findMissionsByIds.mockClear();
    await getMissions("u1", {});
    const second = mockedRepo.findMissionsByIds.mock.calls[0][0];

    expect(second).toEqual(first);
  });

  it("2페이지 조회 시 앞세웠던 템플릿은 다시 끼어들지 않고, rest만 이어서 나온다", async () => {
    mockedRepo.findMissionsByIds.mockImplementation(
      ((ids: string[]) => Promise.resolve(ids.map((id) => buildTemplate(id)))) as never
    );
    mockedRepo.findMissionsExcluding.mockResolvedValue([] as never);

    await getMissions("u1", {}); // 1페이지 — front 4개 계산됨
    const frontIds = mockedRepo.findMissionsByIds.mock.calls[0][0];

    mockedRepo.findMissionsByIds.mockClear();
    mockedRepo.findMissionsExcluding.mockClear();
    await getMissions("u1", { page: 2, size: 10 });

    // 2페이지는 front를 다시 조회하지 않고 rest만, 앞세웠던 4개를 여전히 제외한 채로 이어서 조회한다.
    expect(mockedRepo.findMissionsByIds).not.toHaveBeenCalled();
    expect(mockedRepo.findMissionsExcluding).toHaveBeenCalledWith(
      expect.objectContaining({ excludeIds: frontIds, skip: 6, take: 10 })
    );
  });

  it("origin을 명시해 조회하면 앞세우기를 하지 않는다", async () => {
    await getMissions("u1", { origin: "ai" });

    expect(mockedRepo.findTemplateMissionIds).not.toHaveBeenCalled();
    expect(mockedRepo.findMissionsByIds).not.toHaveBeenCalled();
  });
});

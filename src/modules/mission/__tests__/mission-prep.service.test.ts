jest.mock("../repositories/mission.repository");
jest.mock("../services/prep.service", () => ({
  ...jest.requireActual("../services/prep.service"),
  generateStarters: jest.fn(),
}));

import * as repository from "../repositories/mission.repository";
import * as prepService from "../services/prep.service";
import { getMissionPrep } from "../services/mission.service";
import { STARTER_DISPLAY_COUNT, STARTER_POOL_SIZE } from "../services/prep.service";

const mockedRepo = jest.mocked(repository);
const mockedPrep = jest.mocked(prepService);

// findPrepItemsByType가 돌려주는 행 모양.
const items = (contents: string[]) =>
  contents.map((content, i) => ({
    id: `p${i}`,
    type: "starter",
    content,
    order_index: i,
  })) as never;

const sentences = (n: number, prefix = "문장") =>
  Array.from({ length: n }, (_, i) => `${prefix} ${i}`);

beforeEach(() => {
  jest.clearAllMocks();
  mockedRepo.findMissionById.mockResolvedValue({
    id: "m1",
    title: "카페에서 음료 추천 물어보기",
    description: "설명",
  } as never);
  mockedRepo.deletePrepItemsByType.mockResolvedValue({ count: 0 } as never);
  mockedRepo.createPrepItems.mockResolvedValue({ count: STARTER_POOL_SIZE } as never);
});

describe("getMissionPrep", () => {
  it("캐시가 충분하면 다시 만들지 않는다", async () => {
    mockedRepo.findPrepItemsByType.mockResolvedValue(items(sentences(STARTER_POOL_SIZE)));

    const result = await getMissionPrep("m1");

    expect(mockedPrep.generateStarters).not.toHaveBeenCalled();
    expect(result.items).toHaveLength(STARTER_DISPLAY_COUNT);
  });

  it("표시 개수를 못 채우는 기존 캐시는 비우고 다시 만든다", async () => {
    // 개수 미달을 허용하던 시절에 저장된 부분 캐시. 그대로 두면 그 미션은
    // 재생성 조건에 걸리지 않아 계속 3개 미만으로 노출된다.
    mockedRepo.findPrepItemsByType
      .mockResolvedValueOnce(items(sentences(2)))
      .mockResolvedValue(items(sentences(STARTER_POOL_SIZE, "새 문장")));
    mockedPrep.generateStarters.mockResolvedValue(sentences(STARTER_POOL_SIZE, "새 문장"));

    const result = await getMissionPrep("m1");

    expect(mockedPrep.generateStarters).toHaveBeenCalledTimes(1);
    // order_index가 겹치면 unique 제약에 걸리므로 먼저 비워야 한다.
    expect(mockedRepo.deletePrepItemsByType).toHaveBeenCalledWith("m1", "starter");
    expect(result.items).toHaveLength(STARTER_DISPLAY_COUNT);
    result.items.forEach((item) => expect(item.content).toContain("새 문장"));
  });

  it("재생성에 실패하면 부분 노출 대신 빈 배열을 돌려준다", async () => {
    // 부분 결과를 내보내면 화면이 1~2개만 받는다. 앱 자체 폴백 문구가 낫다.
    mockedRepo.findPrepItemsByType.mockResolvedValue(items(sentences(2)));
    mockedPrep.generateStarters.mockResolvedValue(null);

    const result = await getMissionPrep("m1");

    expect(result.items).toEqual([]);
    expect(result.totalCount).toBe(0);
  });
});

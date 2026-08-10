jest.mock("../../../config/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("../repositories/mission.repository");
jest.mock("../services/playbook.service", () => ({
  ...jest.requireActual("../services/playbook.service"),
  embedPlaybook: jest.fn(),
  generatePlaybook: jest.fn(),
}));

import * as repository from "../repositories/mission.repository";
import { embedPlaybook, generatePlaybook } from "../services/playbook.service";
import {
  deletePlaybook,
  getPlaybook,
  regeneratePlaybook,
  replacePlaybook,
} from "../services/playbook-admin.service";
import {
  MissionNotFoundError,
  PlaybookGenerationFailedError,
  PlaybookNotFoundError,
} from "../errors/mission.error";

const mockedRepo = jest.mocked(repository);
const mockedEmbed = jest.mocked(embedPlaybook);
const mockedGenerate = jest.mocked(generatePlaybook);

const MISSION_ID = "m1";
const UPDATED_AT = new Date("2026-08-03T10:00:00.000Z");

// 사람이 보내는 형태(임베딩 없음)
const input = {
  flow: [
    { step: "도입", advanceExamples: ["안녕하세요", "처음 와봐요"] },
    { step: "전개", advanceExamples: ["저는 등산을 좋아해요", "작년에 여행 갔어요"] },
    { step: "마무리", advanceExamples: ["오늘 즐거웠어요", "다음에 또 봐요"] },
  ],
  responseRules: [{ when: "막힘", then: "선택지를 좁혀 물어보기" }],
};

const inputWithMetadata = {
  ...input,
  objective: "사용자가 먼저 인사하고 짧은 대화를 이어간다.",
  successCriteria: ["사용자가 먼저 인사한다."],
  feedbackFocus: ["대화 시작 여부"],
};

// 저장된 형태(임베딩 포함)
const embedded = {
  flow: input.flow.map((s) => ({ ...s, advanceEmbeddings: [[1, 0], [0, 1]] })),
  responseRules: input.responseRules.map((r) => ({ ...r, whenEmbedding: [1, 0] })),
};

const embeddedWithMetadata = { ...inputWithMetadata, ...embedded };

const setupGuideline = {
  defaults: {
    environment: "daily_place",
    partnerRole: "other",
    intimacyLevel: 2,
    formalityLevel: 3,
    partnerGender: "female",
    partnerAgeGroup: "twenties",
  },
  disabled: {
    environment: [], partnerRole: [], intimacyLevel: [], formalityLevel: [],
    partnerGender: [], partnerAgeGroup: [],
  },
  note: null,
  recommendedTopics: [],
  tags: ["첫 만남", "가벼운 질문"],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockedRepo.findMissionById.mockResolvedValue({
    id: MISSION_ID,
    title: "카페 대화",
    description: "설명",
    category: "짧은 대화",
    difficulty: 2,
    setup_guideline: setupGuideline,
  } as never);
  mockedRepo.upsertPlaybook.mockResolvedValue({ updated_at: UPDATED_AT } as never);
});

describe("getPlaybook", () => {
  it("임베딩을 빼고 텍스트만 돌려준다", async () => {
    mockedRepo.findPlaybookByMissionId.mockResolvedValue({
      data: embedded,
      updated_at: UPDATED_AT,
    } as never);

    const result = await getPlaybook(MISSION_ID);

    expect(result.playbook.flow[0]).toEqual({ step: "도입", advanceExamples: ["안녕하세요", "처음 와봐요"] });
    // 4096차원 × 10개라 응답에 넣으면 1MB가 넘는다.
    expect(JSON.stringify(result)).not.toContain("advanceEmbeddings");
    expect(JSON.stringify(result)).not.toContain("whenEmbedding");
    expect(result.playbook.hasEmbeddings).toBe(true);
  });

  it("임베딩이 없으면 hasEmbeddings=false로 알려준다(단계 진행이 턴 상한으로만 동작)", async () => {
    mockedRepo.findPlaybookByMissionId.mockResolvedValue({
      data: input,
      updated_at: UPDATED_AT,
    } as never);

    expect((await getPlaybook(MISSION_ID)).playbook.hasEmbeddings).toBe(false);
  });

  it("새 optional 필드를 관리자 조회 응답에 포함한다", async () => {
    mockedRepo.findPlaybookByMissionId.mockResolvedValue({
      data: embeddedWithMetadata,
      updated_at: UPDATED_AT,
    } as never);

    const result = await getPlaybook(MISSION_ID);
    expect(result.playbook).toMatchObject({
      objective: inputWithMetadata.objective,
      successCriteria: inputWithMetadata.successCriteria,
      feedbackFocus: inputWithMetadata.feedbackFocus,
    });
    expect(embeddedWithMetadata.flow[0].advanceEmbeddings).toEqual([[1, 0], [0, 1]]);
    expect(embeddedWithMetadata.responseRules[0].whenEmbedding).toEqual([1, 0]);
    expect(result.playbook.hasEmbeddings).toBe(true);
  });

  it("미션이 없으면 MISSION_NOT_FOUND", async () => {
    mockedRepo.findMissionById.mockResolvedValue(null as never);

    await expect(getPlaybook(MISSION_ID)).rejects.toBeInstanceOf(MissionNotFoundError);
  });

  it("플레이북이 없으면 PLAYBOOK_NOT_FOUND", async () => {
    mockedRepo.findPlaybookByMissionId.mockResolvedValue(null as never);

    await expect(getPlaybook(MISSION_ID)).rejects.toBeInstanceOf(PlaybookNotFoundError);
  });

  it("저장된 형식이 깨져 있으면 없는 것으로 본다(다음 대화에서 재생성됨)", async () => {
    mockedRepo.findPlaybookByMissionId.mockResolvedValue({
      data: { flow: ["구형식"] },
      updated_at: UPDATED_AT,
    } as never);

    await expect(getPlaybook(MISSION_ID)).rejects.toBeInstanceOf(PlaybookNotFoundError);
  });
});

describe("replacePlaybook", () => {
  it("텍스트를 고치면 임베딩을 반드시 다시 만든다", async () => {
    mockedEmbed.mockResolvedValue(embedded);

    await replacePlaybook(MISSION_ID, input);

    // 옛 임베딩을 그대로 두면 매칭이 조용히 어긋난다 — 이 호출이 빠지면 안 된다.
    expect(mockedEmbed).toHaveBeenCalledWith(input);
    expect(mockedRepo.upsertPlaybook).toHaveBeenCalledWith(MISSION_ID, embedded);
  });

  it("응답에도 임베딩을 담지 않는다", async () => {
    mockedEmbed.mockResolvedValue(embedded);

    const result = await replacePlaybook(MISSION_ID, input);

    expect(JSON.stringify(result)).not.toContain("advanceEmbeddings");
    expect(result.updatedAt).toBe(UPDATED_AT.toISOString());
  });

  it("새 optional 필드를 포함한 관리자 수정을 저장하고 응답한다", async () => {
    mockedEmbed.mockResolvedValue(embeddedWithMetadata);

    const result = await replacePlaybook(MISSION_ID, inputWithMetadata);

    expect(mockedEmbed).toHaveBeenCalledWith(inputWithMetadata);
    expect(mockedRepo.upsertPlaybook).toHaveBeenCalledWith(MISSION_ID, embeddedWithMetadata);
    expect(result.playbook.objective).toBe(inputWithMetadata.objective);
  });

  it("새 필드가 없는 기존 형식 관리자 PUT도 정상 처리한다", async () => {
    mockedEmbed.mockResolvedValue(embedded);
    await expect(replacePlaybook(MISSION_ID, input)).resolves.toBeDefined();
  });

  it("미션이 없으면 저장하지 않는다", async () => {
    mockedRepo.findMissionById.mockResolvedValue(null as never);

    await expect(replacePlaybook(MISSION_ID, input)).rejects.toBeInstanceOf(MissionNotFoundError);
    expect(mockedRepo.upsertPlaybook).not.toHaveBeenCalled();
  });
});

describe("regeneratePlaybook", () => {
  it("LLM으로 새로 만들어 덮어쓴다", async () => {
    mockedGenerate.mockResolvedValue(embedded);

    const result = await regeneratePlaybook(MISSION_ID);

    expect(mockedGenerate).toHaveBeenCalledWith({
      title: "카페 대화",
      description: "설명",
      category: "짧은 대화",
      difficulty: 2,
      tags: ["첫 만남", "가벼운 질문"],
    });
    expect(mockedRepo.upsertPlaybook).toHaveBeenCalledWith(MISSION_ID, embedded);
    expect(result.playbook.flow).toHaveLength(3);
  });

  it("생성 실패를 조용히 넘기지 않고 알린다(사용자가 의도한 작업이므로)", async () => {
    mockedGenerate.mockResolvedValue(null);

    await expect(regeneratePlaybook(MISSION_ID)).rejects.toBeInstanceOf(
      PlaybookGenerationFailedError
    );
    expect(mockedRepo.upsertPlaybook).not.toHaveBeenCalled();
  });
});

describe("deletePlaybook", () => {
  it("삭제한다", async () => {
    mockedRepo.deletePlaybook.mockResolvedValue({ count: 1 } as never);

    await expect(deletePlaybook(MISSION_ID)).resolves.toBeUndefined();
    expect(mockedRepo.deletePlaybook).toHaveBeenCalledWith(MISSION_ID);
  });

  it("지울 게 없으면 PLAYBOOK_NOT_FOUND", async () => {
    mockedRepo.deletePlaybook.mockResolvedValue({ count: 0 } as never);

    await expect(deletePlaybook(MISSION_ID)).rejects.toBeInstanceOf(PlaybookNotFoundError);
  });
});

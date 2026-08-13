// createMessage의 LLM 연결/폴백 동작 검증. LLM 호출은 mock한다.
jest.mock("../services/conversation-guide.service", () => ({
  ...jest.requireActual("../services/conversation-guide.service"),
  generateGuideReply: jest.fn(),
}));
jest.mock("../services/conversation-role.service", () => ({
  generateRoleSetup: jest.fn(),
}));
jest.mock("../../mission/services/playbook.service", () => ({
  ...jest.requireActual("../../mission/services/playbook.service"),
  generatePlaybook: jest.fn(),
}));
jest.mock("../../mission/repositories/mission.repository", () => ({
  upsertPlaybook: jest.fn(),
  findPrepItemsByType: jest.fn(),
  deletePrepItemsByType: jest.fn(),
  createPrepItems: jest.fn(),
}));
jest.mock("../../mission/services/prep.service", () => ({
  ...jest.requireActual("../../mission/services/prep.service"),
  generateQuestions: jest.fn(),
}));
jest.mock("../../../config/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { ConversationService } from "../services/conversation.service";
import { ConversationRepository } from "../repositories/conversation.repository";
import { generateGuideReply } from "../services/conversation-guide.service";
import { generateRoleSetup } from "../services/conversation-role.service";
import { generatePlaybook } from "../../mission/services/playbook.service";
import {
  upsertPlaybook,
  findPrepItemsByType,
  deletePrepItemsByType,
  createPrepItems,
} from "../../mission/repositories/mission.repository";
import { generateQuestions } from "../../mission/services/prep.service";
import { ConversationError } from "../errors/conversation.error";
import { logger } from "../../../config/logger";

const mockedGenerate = jest.mocked(generateGuideReply);
const mockedRoleSetup = jest.mocked(generateRoleSetup);
const mockedPlaybook = jest.mocked(generatePlaybook);
const mockedUpsert = jest.mocked(upsertPlaybook);
const mockedFindPrepItemsByType = jest.mocked(findPrepItemsByType);
const mockedDeletePrepItemsByType = jest.mocked(deletePrepItemsByType);
const mockedCreatePrepItems = jest.mocked(createPrepItems);
const mockedGenerateQuestions = jest.mocked(generateQuestions);
const mockedWarn = jest.mocked(logger.warn);

// 필요한 메서드만 갖춘 가짜 repository.
const buildRepo = () => {
  const repo = {
    findConversationById: jest.fn().mockResolvedValue({
      id: "c1",
      mission: { id: "m1", title: "카페 인사하기", description: "먼저 인사해보세요." },
    }),
    findRecentMessages: jest.fn().mockResolvedValue([
      { role: "user", content: "안녕" },
      { role: "guide", content: "안녕하세요!" },
    ]),
    findUserProfileForTone: jest
      .fn()
      .mockResolvedValue({ personality_type: "introvert", preferred_style: null }),
    createMessage: jest.fn().mockImplementation((_cid: string, role: string, content: string) =>
      Promise.resolve({
        id: role === "user" ? "u1" : "g1",
        role,
        content,
        created_at: new Date("2026-07-01T00:00:00Z"),
      })
    ),
  };
  return repo as unknown as ConversationRepository & typeof repo;
};

beforeEach(() => jest.clearAllMocks());

// #204 — suggestedReplies가 대화 맥락과 무관한 하드코딩 문장만 나가던 문제. starter와 같은
// 패턴(미션당 1회 LLM 생성 + 캐시)으로 question 타입 prep item을 채운다.
describe("getConversationGuide — suggestedReplies(#204)", () => {
  const buildGuideRepo = (prepItems: { type: string; content: string; order_index: number }[]) => {
    const repo = {
      findConversationById: jest.fn().mockResolvedValue({
        id: "c1",
        mission: {
          id: "m1",
          title: "카페 인사하기",
          description: "먼저 인사해보세요.",
          preparation_tip: null,
          playbook: null,
          prep_items: prepItems,
        },
      }),
    };
    return repo as unknown as ConversationRepository & typeof repo;
  };

  it("question 타입 캐시가 이미 있으면 LLM을 다시 부르지 않고 그대로 쓴다", async () => {
    const repo = buildGuideRepo([
      { type: "question", content: "무슨 음료 좋아하세요?", order_index: 0 },
      { type: "question", content: "여기 자주 오세요?", order_index: 1 },
      { type: "question", content: "오늘 날씨 어때요?", order_index: 2 },
    ]);
    const service = new ConversationService(repo);

    const result = await service.getConversationGuide("u1", "c1");

    expect(mockedGenerateQuestions).not.toHaveBeenCalled();
    expect(result.suggestedReplies).toHaveLength(2);
    expect(["무슨 음료 좋아하세요?", "여기 자주 오세요?", "오늘 날씨 어때요?"]).toEqual(
      expect.arrayContaining(result.suggestedReplies)
    );
  });

  it("캐시가 없으면 LLM으로 생성해 캐시하고 그중 일부를 반환한다", async () => {
    const repo = buildGuideRepo([]);
    const service = new ConversationService(repo);
    mockedGenerateQuestions.mockResolvedValue([
      "무슨 음료 좋아하세요?",
      "여기 자주 오세요?",
      "오늘 날씨 어때요?",
    ]);
    mockedFindPrepItemsByType.mockResolvedValue([
      { id: "p1", type: "question", content: "무슨 음료 좋아하세요?", order_index: 0 },
      { id: "p2", type: "question", content: "여기 자주 오세요?", order_index: 1 },
      { id: "p3", type: "question", content: "오늘 날씨 어때요?", order_index: 2 },
    ] as never);

    const result = await service.getConversationGuide("u1", "c1");

    expect(mockedGenerateQuestions).toHaveBeenCalledWith("카페 인사하기", "먼저 인사해보세요.");
    expect(mockedDeletePrepItemsByType).toHaveBeenCalledWith("m1", "question");
    expect(mockedCreatePrepItems).toHaveBeenCalledWith("m1", "question", [
      "무슨 음료 좋아하세요?",
      "여기 자주 오세요?",
      "오늘 날씨 어때요?",
    ]);
    expect(result.suggestedReplies).toHaveLength(2);
  });

  it("LLM 생성까지 실패하면 최종 폴백 문장을 쓴다", async () => {
    const repo = buildGuideRepo([]);
    const service = new ConversationService(repo);
    mockedGenerateQuestions.mockResolvedValue(null);

    const result = await service.getConversationGuide("u1", "c1");

    expect(mockedCreatePrepItems).not.toHaveBeenCalled();
    expect(result.suggestedReplies).toEqual(["그렇군요! 저도 그렇게 생각해요.", "오늘 하루 어떠셨어요?"]);
  });
});

describe("createConversation — 공통 미션 플레이북", () => {
  const mission = {
    id: "11111111-1111-4111-8111-111111111111",
    title: "카페 직원에게 인사하기",
    description: "먼저 인사해 보세요.",
    category: "짧은 대화",
    difficulty: 1,
    setup_guideline: {
      defaults: {
        environment: "daily_place", partnerRole: "other", intimacyLevel: 1,
        formalityLevel: 3, partnerGender: "female", partnerAgeGroup: "twenties",
      },
      disabled: {
        environment: [], partnerRole: [], intimacyLevel: [], formalityLevel: [],
        partnerGender: [], partnerAgeGroup: [],
      },
      note: null,
      recommendedTopics: [],
      tags: ["첫 만남", "가벼운 인사"],
    },
    playbook: null,
  };

  const buildCreateRepo = () => {
    const repo = {
      findMissionById: jest.fn().mockResolvedValue(mission),
      createConversation: jest.fn().mockResolvedValue({
        id: "c1", mode: "text", selected_topic: null,
        started_at: new Date("2026-08-09T00:00:00.000Z"),
      }),
      createMessage: jest.fn().mockResolvedValue({}),
    };
    return repo as unknown as ConversationRepository & typeof repo;
  };

  beforeEach(() => {
    mockedRoleSetup.mockResolvedValue({ persona: "직원", userTask: "먼저 인사하기" });
    mockedPlaybook.mockResolvedValue({ flow: [], responseRules: [] });
    mockedUpsert.mockResolvedValue({} as never);
  });

  it("자동 생성에 미션 공통 컨텍스트만 전달한다", async () => {
    const service = new ConversationService(buildCreateRepo());

    await service.createConversation("u1", {
      missionId: mission.id,
      mode: "text",
    });

    expect(mockedPlaybook).toHaveBeenCalledWith({
      title: mission.title,
      description: mission.description,
      category: mission.category,
      difficulty: mission.difficulty,
      tags: ["첫 만남", "가벼운 인사"],
    });
    const context = mockedPlaybook.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(context).not.toHaveProperty("missionSetup");
    expect(context).not.toHaveProperty("persona");
    expect(context).not.toHaveProperty("userTask");
  });

  it("플레이북 생성 실패에도 기존 대화 생성 fallback을 유지한다", async () => {
    const repo = buildCreateRepo();
    mockedPlaybook.mockResolvedValue(null);

    await expect(
      new ConversationService(repo).createConversation("u1", {
        missionId: mission.id,
        mode: "text",
      })
    ).resolves.toMatchObject({ conversationId: "c1" });
    expect(mockedUpsert).not.toHaveBeenCalled();
    expect(repo.createConversation).toHaveBeenCalled();
  });

  it("플레이북 생성 예외가 발생해도 기존 대화 생성을 계속한다", async () => {
    const repo = buildCreateRepo();
    const error = new Error("playbook generation failed");
    mockedPlaybook.mockRejectedValue(error);

    await expect(
      new ConversationService(repo).createConversation("u1", {
        missionId: mission.id,
        mode: "text",
      })
    ).resolves.toMatchObject({ conversationId: "c1" });
    expect(mockedUpsert).not.toHaveBeenCalled();
    expect(repo.createConversation).toHaveBeenCalled();
    expect(mockedWarn).toHaveBeenCalledWith(
      { err: error, missionId: mission.id },
      "대화 시작 중 플레이북 자동 생성 실패 — 플레이북 없이 진행"
    );
  });
});

describe("createMessage", () => {
  it("LLM 응답이 있으면 그 내용을 guide 메시지로 저장한다", async () => {
    const repo = buildRepo();
    mockedGenerate.mockResolvedValue("긴장되는 게 당연해요. 천천히 해봐요!");
    const service = new ConversationService(repo);

    const result = await service.createMessage("u", "c1", { role: "user", content: "좀 긴장돼요" });

    expect(result.guideMessage.content).toBe("긴장되는 게 당연해요. 천천히 해봐요!");
    expect(repo.createMessage).toHaveBeenCalledWith("c1", "guide", "긴장되는 게 당연해요. 천천히 해봐요!");
  });

  it("LLM이 null이면 템플릿 폴백으로 저장한다 (대화가 끊기지 않음)", async () => {
    const repo = buildRepo();
    mockedGenerate.mockResolvedValue(null);
    const service = new ConversationService(repo);

    const result = await service.createMessage("u", "c1", { role: "user", content: "좀 긴장돼요" });

    expect(result.guideMessage.content).toBeTruthy();
    expect(repo.createMessage).toHaveBeenCalledWith("c1", "guide", expect.any(String));
    // guide 메시지는 저장되어야 한다 (user + guide 2회 호출)
    expect(repo.createMessage).toHaveBeenCalledTimes(2);
  });

  it("이전 맥락과 톤 설정을 LLM에 전달한다", async () => {
    const repo = buildRepo();
    mockedGenerate.mockResolvedValue("응답");
    const service = new ConversationService(repo);

    await service.createMessage("u", "c1", { role: "user", content: "좀 긴장돼요" });

    const ctx = mockedGenerate.mock.calls[0][0];
    expect(ctx.missionTitle).toBe("카페 인사하기");
    expect(ctx.missionDescription).toBe("먼저 인사해보세요.");
    expect(ctx.personality).toBe("introvert");
    expect(ctx.latestUserMessage).toBe("좀 긴장돼요");
    expect(ctx.history).toHaveLength(2);
  });

  it("대화가 없으면 conversationNotFound를 던진다", async () => {
    const repo = buildRepo();
    repo.findConversationById = jest.fn().mockResolvedValue(null);
    const service = new ConversationService(repo);

    await expect(
      service.createMessage("u", "c1", { role: "user", content: "안녕하세요" })
    ).rejects.toBeInstanceOf(ConversationError);
    expect(mockedGenerate).not.toHaveBeenCalled();
  });

  it("입력이 너무 짧으면 LLM을 호출하지 않고 에러를 던진다", async () => {
    const repo = buildRepo();
    const service = new ConversationService(repo);

    await expect(
      service.createMessage("u", "c1", { role: "user", content: "a" })
    ).rejects.toBeInstanceOf(ConversationError);
    expect(mockedGenerate).not.toHaveBeenCalled();
  });
});

describe("finishConversation", () => {
  const buildFinishRepo = (messages: { role: "user" | "guide" | "system"; content: string }[]) => {
    const repo = {
      findConversationWithMessages: jest.fn().mockResolvedValue({
        id: "c1",
        status: "in_progress",
        started_at: new Date("2026-08-13T00:00:00Z"),
        messages,
      }),
      finishConversation: jest.fn().mockResolvedValue(true),
    };
    return repo as unknown as ConversationRepository & typeof repo;
  };

  it("사용자 발화가 없으면 archive 생성 플래그를 false로 전달하면서 대화를 종료한다", async () => {
    const repo = buildFinishRepo([{ role: "guide", content: "안녕하세요" }]);

    await new ConversationService(repo).finishConversation("u1", "c1", { status: "completed" });

    expect(repo.finishConversation).toHaveBeenCalledWith(
      "u1",
      "c1",
      "completed",
      expect.any(Date),
      false
    );
  });

  it("사용자 발화가 한 건 이상이면 archive 생성 플래그를 true로 전달한다", async () => {
    const repo = buildFinishRepo([{ role: "user", content: "네" }]);

    await new ConversationService(repo).finishConversation("u1", "c1", { status: "completed" });

    expect(repo.finishConversation).toHaveBeenCalledWith(
      "u1",
      "c1",
      "completed",
      expect.any(Date),
      true
    );
  });
});

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
}));

import { ConversationService } from "../services/conversation.service";
import { ConversationRepository } from "../repositories/conversation.repository";
import { generateGuideReply } from "../services/conversation-guide.service";
import { generateRoleSetup } from "../services/conversation-role.service";
import { generatePlaybook } from "../../mission/services/playbook.service";
import { upsertPlaybook } from "../../mission/repositories/mission.repository";
import { ConversationError } from "../errors/conversation.error";

const mockedGenerate = jest.mocked(generateGuideReply);
const mockedRoleSetup = jest.mocked(generateRoleSetup);
const mockedPlaybook = jest.mocked(generatePlaybook);
const mockedUpsert = jest.mocked(upsertPlaybook);

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

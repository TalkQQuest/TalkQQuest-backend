// createMessage의 LLM 연결/폴백 동작 검증. LLM 호출은 mock한다.
jest.mock("../services/conversation-guide.service", () => ({
  ...jest.requireActual("../services/conversation-guide.service"),
  generateGuideReply: jest.fn(),
}));

import { ConversationService } from "../services/conversation.service";
import { ConversationRepository } from "../repositories/conversation.repository";
import { generateGuideReply } from "../services/conversation-guide.service";
import { ConversationError } from "../errors/conversation.error";

const mockedGenerate = jest.mocked(generateGuideReply);

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

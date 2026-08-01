import {
  buildIdentityResponse,
  matchesIdentityQuestion,
  validateReply,
} from "../services/conversation-guard.service";
import { AI_IDENTITY_PHRASE } from "../dtos/conversation.constants";

describe("matchesIdentityQuestion", () => {
  it("실제 보고된 질문을 잡는다", () => {
    expect(matchesIdentityQuestion("너 정체가 뭐야? 사람이야 AI야?")).toBe(true);
  });

  it.each([
    "너 사람이야?",
    "당신 AI인가요?",
    "너 챗봇이지?",
    "혹시 인공지능이야?",
    "당신 정체가 뭐예요",
    "너 누구야",
    "진짜 사람 맞아요?",
  ])("정체를 묻는 표현을 잡는다: %s", (message) => {
    expect(matchesIdentityQuestion(message)).toBe(true);
  });

  it.each([
    "안녕하세요, 이번에 새로 들어왔어요",
    "취미가 뭐예요?", // 상대의 취미를 묻는 것 — 정체 질문이 아니다
    "이 근처 자주 오세요?",
    "요즘 뭐 하고 지내세요?",
    "",
  ])("일반 대화는 잡지 않는다: %s", (message) => {
    expect(matchesIdentityQuestion(message)).toBe(false);
  });
});

describe("buildIdentityResponse", () => {
  it("고정 문구로 답하고 배역으로 복귀한다", () => {
    const reply = buildIdentityResponse("동아리 1년차 선배");
    expect(reply).toContain(AI_IDENTITY_PHRASE);
    expect(reply).toContain("동아리 1년차 선배");
  });

  it("배역이 없어도 복귀 문구를 붙인다", () => {
    const reply = buildIdentityResponse(null);
    expect(reply).toContain(AI_IDENTITY_PHRASE);
    expect(reply).toContain("이어갈게요");
  });
});

describe("validateReply", () => {
  it("정상 대화체는 통과한다", () => {
    expect(validateReply("그러게요, 산책하기 좋은 날씨예요!")).toBeNull();
  });

  it("고정 문구를 그대로 쓴 답변은 통과한다", () => {
    expect(validateReply(`${AI_IDENTITY_PHRASE} 자, 다시 이어갈게요!`)).toBeNull();
  });

  it("고정 문구가 아닌 자기소개는 배역 이탈로 거부한다", () => {
    // 실제 관찰된 형태 — 매번 다른 자기소개를 지어냈다.
    expect(validateReply("저는 대화 연습을 돕는 AI입니다.")).toBe("identity_drift");
    expect(
      validateReply("저는 동아리 활동을 돕는 AI 도우미예요! 친구들을 연결해드려요.")
    ).toBe("identity_drift");
  });

  it("세척 후에도 남은 마크다운은 거부한다", () => {
    expect(validateReply("**정말요?** 저도 그래요")).toBe("format_leak");
  });

  it("자기 해설 괄호가 남아 있으면 거부한다", () => {
    expect(
      validateReply("좋네요! (자연스러운 대화를 위해 질문을 덧붙여 봤습니다)")
    ).toBe("format_leak");
  });

  it("문장이 너무 많으면 거부한다", () => {
    expect(validateReply("네. 그렇군요. 저도요. 정말 좋네요. 또 얘기해요.")).toBe("too_long");
  });

  it("빈 문자열은 거부한다", () => {
    expect(validateReply("   ")).toBe("empty");
  });
});

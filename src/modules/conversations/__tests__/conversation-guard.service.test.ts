import {
  buildIdentityResponse,
  matchesIdentityQuestion,
  validateReply,
} from "../services/conversation-guard.service";
import { cleanReply } from "../services/conversation-guard.service";
import { AI_IDENTITY_PHRASE, buildOpeningMessage } from "../dtos/conversation.constants";

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

  // 오탐이 나면 역할극 도중 고정 정체 응답이 끼어들고 그대로 대화 이력에 저장된다.
  it.each([
    ["그 사람이야? 네가 말한 선배가?", "지시어가 붙으면 제3자를 가리킨다"],
    ["저 사람인가요? 아까 말한 그분?", "지시어가 붙으면 제3자를 가리킨다"],
    ["여기 뭐예요?", "장소를 묻는 말이지 상대의 정체를 묻는 게 아니다"],
    ["그러니까 그게 뭐야?", "'니'는 2인칭이 아니라 어미의 일부다"],
    ["재미있으니 또 뭐야 그런 거 있어요?", "'니'는 2인칭이 아니라 어미의 일부다"],
  ])("역할극 발화를 정체 질문으로 오인하지 않는다: %s", (message) => {
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

  it("고정 문구 뒤에 기능 설명을 덧붙이면 배역 이탈로 거부한다", () => {
    // 포함 여부만 보면 통과했다. 정체 질문은 서버가 직접 답하고 이 검증을 타지 않으므로,
    // 여기 도달한 정체 언급은 고정 문구가 섞여 있어도 LLM이 지어낸 것이다.
    expect(validateReply(`${AI_IDENTITY_PHRASE} 저는 AI라서 일정 관리도 도와드려요!`)).toBe(
      "identity_drift"
    );
  });

  it.each([
    ["1. 안녕하세요.", "번호 목록"],
    ["• 안녕하세요.", "불릿 목록"],
    ["오늘 날씨 좋네요.\n어디 가세요?", "여러 줄"],
    ['{"reply": "안녕하세요"}', "프롬프트 JSON 형식 누출"],
  ])("형식이 새면 거부한다: %s", (reply) => {
    expect(validateReply(reply)).toBe("format_leak");
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

describe("buildOpeningMessage", () => {
  it("파트너임을 밝히고 현재 배역을 안내한다(B안)", () => {
    const opening = buildOpeningMessage("카페 점원에게 인사하기");
    expect(opening).toContain(AI_IDENTITY_PHRASE);
    expect(opening).toContain("카페 점원에게 인사하기");
  });
});

describe("cleanReply", () => {
  it("답변 끝에 이모지가 붙어 있어도 닫는 따옴표를 걷어낸다", () => {
    // 실제 보고된 형태 — 여는 따옴표 없이 닫는 것만 남아 말풍선에 노출됐다.
    expect(cleanReply('그러면 보통 어떤 방식으로 교환하시나요?" 😊')).toBe(
      "그러면 보통 어떤 방식으로 교환하시나요? 😊"
    );
  });

  it("답변 전체를 감싼 따옴표는 꼬리 이모지를 남기고 벗겨낸다", () => {
    expect(cleanReply('"오늘 날씨 좋네요!" 😊')).toBe("오늘 날씨 좋네요! 😊");
  });

  it("따옴표로만 감싼 일반 답변도 벗겨낸다", () => {
    expect(cleanReply('"안녕하세요, 반가워요."')).toBe("안녕하세요, 반가워요.");
  });

  it("문장 중간의 따옴표(인용)는 건드리지 않는다", () => {
    const text = '친구가 "고마워"라고 하더라고요.';
    expect(cleanReply(text)).toBe(text);
  });

  it("문장 첫머리의 인용부호는 감싼 따옴표로 오인하지 않는다", () => {
    // 여는 따옴표가 맨 앞에 있지만 닫는 따옴표 뒤에 글자가 이어진다.
    // 감싼 것으로 보고 떼면 인용부호가 사라져 뜻이 달라진다.
    const text = '"고마워"라고 먼저 말해봤어요.';
    expect(cleanReply(text)).toBe(text);
  });

  it("자기 해설 괄호를 제거한다", () => {
    // 실제 보고된 형태
    const raw =
      "저는 AI 도우미예요! 취미 물어보기는 어땠나요? (자연스러운 대화를 이어가기 위한 후속 질문을 덧붙여 봤습니다) 혹시 동아리 활동 중에 해보고 싶은 게 있으신가요?";
    const cleaned = cleanReply(raw);
    expect(cleaned).not.toContain("후속 질문을 덧붙여");
    expect(cleaned).toContain("혹시 동아리 활동 중에");
  });

  it("짧은 감정·행동 묘사 괄호는 남긴다", () => {
    expect(cleanReply("아 그래요? (웃음)")).toBe("아 그래요? (웃음)");
  });

  it("인용 기호와 마크다운 강조를 제거한다", () => {
    expect(cleanReply("> **정말요?** 저도 그래요")).toBe("정말요? 저도 그래요");
  });
});

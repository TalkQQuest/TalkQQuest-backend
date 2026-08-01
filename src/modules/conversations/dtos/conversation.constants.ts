// modules/conversations/dtos/conversation.constants.ts
// 프롬프트 생성(conversation-llm)과 가드레일(conversation-guard) 양쪽에서 쓰는 값.
// 두 모듈이 서로를 import하면 순환이 생기므로 여기로 뺀다.

// 정체를 물었을 때 쓰는 고정 문구(B안). 매번 다른 자기소개를 지어내던 문제를 막는다.
// 실제 관찰된 사례: "대화 연습을 돕는 AI" / "동아리 활동을 돕는 AI 도우미예요! 사람 친구들을
// 더 편하게 연결할 수 있도록…"(앱에 없는 기능) 등 답변이 매번 달랐다.
// 이 문구를 바꾸면 가드레일의 검증 기준도 함께 바뀐다.
export const AI_IDENTITY_PHRASE = "저는 톡퀘스트 대화 연습 파트너예요.";

// 대화 시작 시 서버가 내려주는 첫 메시지(B안). 지금 어떤 배역으로 대화하는지 먼저 알려준 뒤
// 역할극을 시작한다. 앱이 자체 임시 문구를 띄우던 자리를 대체한다.
export const buildOpeningMessage = (missionTitle: string): string =>
  `(${AI_IDENTITY_PHRASE} 지금부터 "${missionTitle}" 상황의 상대역으로 대화할게요.)`;

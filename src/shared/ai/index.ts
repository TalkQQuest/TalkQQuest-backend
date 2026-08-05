// shared/ai
//
// AI 기능의 공통 배관. 도메인 서비스는 여기서 가져다 조합만 하면 되도록 모아 둔다.
//
//   upstage.client — Upstage 저수준 호출 (chat / embedding). 성공하면 원문, 실패하면 사유만 반환.
//   json           — JSON 응답 파싱 + zod 검증
//   list           — "한 줄에 하나씩" 형태 응답 파싱, 무작위 선택
//   generate       — 생성 → 검증 → 1회 재시도 → 폴백 루프
//   similarity     — 임베딩 유사도로 후보 고르기
//
// ── 새 AI 기능을 추가할 때 ──
// 프롬프트와 스키마는 **그 기능이 속한 도메인 모듈**에 둔다(예: 피드백 분석 → modules/feedback).
// 여기에 도메인 로직을 넣지 않는다. 그래야 여러 명이 각자 도메인만 건드리며 나란히 작업할 수 있다.
//
// 전형적인 형태:
//   const result = await generateWithRetry(async () => {
//     const res = await callUpstageChat(messages, { jsonMode: true });
//     if (!res.ok) return null;
//     return parseJsonResponse(res.content, mySchema, "내 기능");
//   }, { label: "내 기능" });
//
// AI 응답은 언제든 형식이 틀어질 수 있으므로 실패는 예외가 아니라 null로 다룬다.
// 호출부가 폴백(템플릿/빈 값/status=failed)을 정한다.

export * from "./upstage.client";
export * from "./json";
export * from "./list";
export * from "./generate";
export * from "./similarity";

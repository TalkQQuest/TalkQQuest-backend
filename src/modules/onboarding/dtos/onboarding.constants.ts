// modules/onboarding/dtos/onboarding.constants.ts
// 온보딩 단계 2·3의 선택지는 Figma에서 고정된 목록이라 자유 문자열 대신 enum으로 강제한다.

// 온보딩 2단계 — 대화에서 가장 어려운 점 (최대 2개, 그중 1개까지는 직접 입력 허용).
export const DIFFICULT_SITUATIONS = [
  "낯가림",
  "주제고민",
  "말문 막힘",
  "시선 부담",
  "긴장됨",
  "걱정/불안",
  "상대 파악 어려움",
  "어색함",
] as const;
export type DifficultSituation = (typeof DIFFICULT_SITUATIONS)[number];

// 온보딩 3단계 — 연습하고 싶은 대화 유형 (최대 2개, 직접 입력 없음).
export const PRACTICE_PURPOSES = [
  "자신감 키우기",
  "말문 트기",
  "침묵 줄이기",
  "자연스럽게 말하기",
  "상황에 맞는 대화",
  "친해지는 대화",
  "첫인상 개선하기",
] as const;
export type PracticePurpose = (typeof PRACTICE_PURPOSES)[number];

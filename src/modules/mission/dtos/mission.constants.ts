// modules/mission/dtos/mission.constants.ts
export type MissionDifficultyLabel = "쉬움" | "보통" | "어려움";

export const DIFFICULTY_TO_INT: Record<MissionDifficultyLabel, number> = {
  쉬움: 1,
  보통: 2,
  어려움: 3,
};

export const DIFFICULTY_TO_LABEL: Record<number, MissionDifficultyLabel> = {
  1: "쉬움",
  2: "보통",
  3: "어려움",
};

// 오늘의 미션을 다시 뽑을 수 있는 하루 최대 횟수. 그날의 첫 생성은 새로고침으로 세지 않으므로
// 하루에 만들어지는 추천은 최대 1 + MISSION_REFRESH_LIMIT건이다.
// LLM(Upstage) 호출 비용과 직결되는 값이라 정책이 바뀌면 여기만 고치면 된다.
export const MISSION_REFRESH_LIMIT = 3;

// 클라이언트가 보낸 날짜를 서버(KST) 기준 오늘과 며칠까지 다르게 허용할지.
// 시간대가 다른 기기(예: 해외 체류)를 위해 ±1일은 열어두되, 임의의 과거/미래 날짜로
// 새로고침 제한을 우회하는 것은 막는다.
export const MISSION_DATE_TOLERANCE_DAYS = 1;

// 미션 목록에서 각 항목이 어디서 왔는지. 프런트가 "템플릿"과 "나와 비슷한 성향의 사용자가
// 수행한 AI 미션"을 구분해 보여주기 위해 사용한다.
export type MissionOrigin = "template" | "ai";
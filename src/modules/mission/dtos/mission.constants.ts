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
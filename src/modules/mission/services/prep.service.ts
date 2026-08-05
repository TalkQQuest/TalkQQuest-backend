// modules/mission/services/prep.service.ts
// 미션별 "바로 쓰는 첫 마디"(Mission_Prep_Items.type=starter) 생성.
//
// 기존에는 준비 문장이 어느 미션에도 채워져 있지 않아 GET /missions/{id}/prep이 항상 빈 배열을
// 돌려줬고, 앱이 화면을 채우려고 자체 임시 문구를 띄우면서 모든 미션에서 같은 첫 마디가 보였다.
// 미션을 사람이 일일이 채우는 대신 LLM으로 만들어 캐시한다 — AI 추천으로 새로 생성되는 미션까지
// 자동으로 커버되어야 하기 때문이다.

import { logger } from "../../../config/logger";
import {
  callUpstageChat,
  parseLineList,
  pickRandom,
  UpstageChatMessage,
} from "../../../shared/ai";

// 한 미션당 만들어 두는 후보 수. 새로고침할 때마다 다른 문장이 나와야 해서
// 노출 개수(3)보다 넉넉히 만들어 두고 그중에서 골라 준다.
export const STARTER_POOL_SIZE = 9;
// 화면에 한 번에 보여주는 개수(시안 기준).
export const STARTER_DISPLAY_COUNT = 3;

const MAX_TOKENS = 500;
const TEMPERATURE = 0.9; // 후보가 서로 비슷해지지 않도록
const MAX_STARTER_LENGTH = 40; // 시안상 한 줄로 보이는 길이

const buildStarterMessages = (
  missionTitle: string,
  missionDescription: string | null
): UpstageChatMessage[] => {
  const lines = [
    "당신은 대화 연습 앱에서 사용자가 첫 마디를 떼도록 돕는 도우미입니다.",
    `사용자가 연습할 상황: ${missionTitle}`,
  ];
  if (missionDescription) {
    lines.push(`상황 설명: ${missionDescription}`);
  }
  lines.push(
    "",
    "규칙:",
    `- 이 상황에서 **사용자가 상대에게 먼저 건넬 수 있는** 첫 마디를 정확히 ${STARTER_POOL_SIZE}개 만듭니다.`,
    "- 이 상황에 딱 맞아야 합니다. 어떤 상황에도 쓸 수 있는 일반적인 인사말은 넣지 마세요.",
    `- 각 문장은 ${MAX_STARTER_LENGTH}자 이내의 짧은 구어체 한 문장입니다.`,
    "- 서로 다른 화제로 겹치지 않게 만듭니다.",
    "- 번호·불릿·따옴표·설명 없이, 문장만 한 줄에 하나씩 씁니다."
  );

  return [
    { role: "system", content: lines.join("\n") },
    { role: "user", content: `"${missionTitle}" 상황에서 쓸 첫 마디를 만들어주세요.` },
  ];
};

// 첫 마디로 쓸 수 있는 형식인지. 여기서 통과한 문장은 그대로 캐시돼 계속 노출되므로,
// 형식이 어긋난 건 고치려 하지 말고 버린다(잘못 저장하면 미션당 1회 생성이라 계속 남는다).
const isValidStarter = (line: string): boolean => {
  if (line.length === 0 || line.length > MAX_STARTER_LENGTH) return false;
  // 한 줄이어야 한다 — 줄바꿈이 남았다면 파싱이 어긋난 것.
  if (/[\n\r]/.test(line)) return false;
  // 걷어내지 못한 번호·불릿·마크다운이 남아 있으면 버린다.
  if (/^\s*(?:[-*•>#]|\d+[.)])/.test(line)) return false;
  if (/[*_`]/.test(line)) return false;
  // 따옴표가 짝 없이 남은 경우.
  if (/["'“”]/.test(line)) return false;
  // 설명문(해설 괄호)이 섞인 경우.
  if (/[(（][^)）]{10,}[)）]/.test(line)) return false;
  // 실제 건넬 한 마디여야 하므로 종결 부호로 끝나야 한다.
  if (!/[.!?~요죠까네](?:\s*[’'"”])?$/.test(line)) return false;
  return true;
};

// 줄 단위 파싱·중복 제거·머리기호 정리는 공통 헬퍼가 처리하고, 여기서는 "첫 마디로 쓸 수
// 있는 형식인지"만 판단한다.
const parseStarters = (raw: string): string[] =>
  parseLineList(raw, { limit: STARTER_POOL_SIZE, isValid: isValidStarter });

// 미션별 첫 마디 후보 생성. 실패하거나 결과가 비면 null → 호출부가 폴백을 쓴다.
export const generateStarters = async (
  missionTitle: string,
  missionDescription: string | null
): Promise<string[] | null> => {
  const result = await callUpstageChat(buildStarterMessages(missionTitle, missionDescription), {
    temperature: TEMPERATURE,
    maxTokens: MAX_TOKENS,
  });
  if (!result.ok) {
    logger.warn({ reason: result.reason }, "미션 첫 마디 생성 LLM 호출 실패");
    return null;
  }

  const starters = parseStarters(result.content);
  // 화면에 보여줄 개수를 못 채우면 캐시하지 않고 폴백으로 넘긴다.
  // 미션당 1회만 생성해 그대로 굳기 때문에, 1~2개만 살아남은 결과를 저장하면
  // 그 미션은 계속 3개 미만으로 노출된다(새로고침해도 늘 같은 문장).
  return starters.length >= STARTER_DISPLAY_COUNT ? starters : null;
};

// 후보 중 화면에 보여줄 만큼 무작위로 고른다.
// 앱의 새로고침 버튼이 같은 API를 다시 부르는 구조라, 매번 다른 조합이 나가면 그대로 동작한다.
export const pickRandomStarters = (pool: string[], count = STARTER_DISPLAY_COUNT): string[] =>
  pickRandom(pool, count);

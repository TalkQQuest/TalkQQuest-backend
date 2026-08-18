// modules/conversations/services/conversation-role.service.ts
//
// 세션 생성 시 1회 실행 — 이 대화에서 AI가 맡을 배역과 "사용자가 해야 할 일"을 정한다.
// 두 값 모두 Conversations에 저장돼 매 턴 프롬프트에 주입되므로, 여기서 잘못 잡으면
// 대화 전체가 어긋난다. 형식이 어긋나면 저장하지 않고 null로 두는 편이 낫다.

import { z } from "zod";
import { callUpstageChat, parseJsonResponse } from "../../../shared/ai";
import { logger } from "../../../config/logger";
import {
    MissionSetupEnvironment,
    MissionSetupPartnerAgeGroup,
    MissionSetupPartnerGender,
    MissionSetupPartnerRole,
} from "../../mission/dtos/mission.dto";

const ROLE_SETUP_MAX_TOKENS = 200;
const ROLE_SETUP_MAX_LENGTH = 100; // 두 컬럼 모두 VARCHAR(255)라 넉넉히 잡아도 안전

export interface RoleSetup {
  persona: string | null;
  userTask: string | null;
}

// 사용자가 미션 창에서 고른 상황 설정(Mission_Setups). 구조화된 축이라 라벨 매핑을 거쳐
// 프롬프트에 자연어로 풀어 넣는다 — enum/정수 그대로 넣으면 LLM이 못 알아듣는다.
export interface MissionSetupContext {
  environment: MissionSetupEnvironment;
  partnerRole: MissionSetupPartnerRole;
  partnerGender: MissionSetupPartnerGender;
  partnerAgeGroup: MissionSetupPartnerAgeGroup;
  intimacyLevel: number;
  formalityLevel: number;
}

const ENVIRONMENT_LABEL: Record<MissionSetupEnvironment, string> = {
  school: "학교/대학교",
  workplace: "직장",
  daily_place: "동네·일상 공간(카페, 헬스장, 편의점 등)",
  community: "모임·커뮤니티(동아리, 스터디, 소모임)",
  online: "온라인(SNS, 채팅)",
};

const PARTNER_ROLE_LABEL: Record<MissionSetupPartnerRole, string> = {
  friend: "친구",
  senior: "선배",
  junior: "후배",
  peer: "동기·동료",
  other: "초면이거나 아는 지인 정도의 사이",
};

const PARTNER_GENDER_LABEL: Record<MissionSetupPartnerGender, string> = {
  male: "남성",
  female: "여성",
};

const PARTNER_AGE_GROUP_LABEL: Record<MissionSetupPartnerAgeGroup, string> = {
  teens: "10대",
  twenties: "20대",
  thirties: "30대",
  forties: "40대",
  fifties: "50대",
  sixties_plus: "60대 이상",
};

const INTIMACY_LABEL: Record<number, string> = {
  1: "매우 낯선 사이",
  2: "약간 낯선 사이",
  3: "보통 사이",
  4: "친한 사이",
  5: "매우 친한 사이",
};

const FORMALITY_LABEL: Record<number, string> = {
  1: "편한 반말",
  2: "부드러운 반말",
  3: "보통 존댓말",
  4: "정중한 존댓말",
  5: "매우 격식 있는 존댓말",
};

const roleSetupSchema = z.object({
  persona: z.string().min(1).max(ROLE_SETUP_MAX_LENGTH),
  userTask: z.string().min(1).max(ROLE_SETUP_MAX_LENGTH),
});

const parseRoleSetup = (raw: string): RoleSetup => {
  const parsed = parseJsonResponse(raw, roleSetupSchema, "배역 설정");
  if (!parsed) return { persona: null, userTask: null };

  return {
    persona: parsed.persona.split("\n")[0].trim(),
    userTask: parsed.userTask.split("\n")[0].trim(),
  };
};

// #250 — persona가 "동아리 1년차 선배, 친근한 존댓말"처럼 AI 자신의 배역만 서술하고,
// 그 배역 기준으로 "사용자를 어떻게 대해야 하는지(호칭·태도의 방향)"는 명시하지 않았다.
// 그래서 사용자가 먼저 "선배님"이라고 부르면 LLM이 그 호칭을 그대로 반사해 역할이
// 뒤집히는 사례가 있었다. 이 방향 정보를 매번 LLM이 자연어로 정확히 표현하길 기대하는
// 대신, 구조화된 partnerRole 값에서 결정적으로(항상 같은 문장으로) 만들어 persona 뒤에
// 덧붙인다 — LLM 생성 품질에 기대지 않는 구조적 방지책이다.
const PARTNER_ROLE_DIRECTION_CLAUSE: Record<MissionSetupPartnerRole, string> = {
  friend: "사용자는 당신의 친구입니다. 사용자가 어떤 호칭이나 말투를 쓰든 그것과 무관하게 서로 편한 친구 사이를 유지합니다.",
  senior: "사용자는 당신의 후배입니다. 사용자가 당신을 '선배님' 등으로 부르거나 높임말을 쓰더라도, 그 호칭에 이끌려 역할을 사용자 쪽으로 넘기지 말고 당신이 계속 선배 입장을 유지하며 사용자를 편하게 대합니다.",
  junior: "사용자는 당신의 선배입니다. 당신이 사용자보다 손아랫사람이라는 점을 계속 유지하며, 사용자를 높여 대합니다.",
  peer: "사용자는 당신과 동기·동료 관계입니다. 서로 대등한 위치를 유지합니다.",
  other: "사용자는 당신과 초면이거나 가벼운 친분이 있는 사이입니다. 상대의 지위를 넘겨짚어 자신을 손윗사람으로 대하지 않습니다.",
};

// Conversations.persona는 VARCHAR(255)다. persona(최대 100자) + 방향 문구를 합쳐도
// 넉넉히 안전하지만, 방어적으로 컬럼 한도에 맞춰 자른다.
const PERSONA_COLUMN_MAX_LENGTH = 255;

const applyPartnerRoleDirection = (
  persona: string,
  partnerRole: MissionSetupPartnerRole
): string =>
  `${persona} (${PARTNER_ROLE_DIRECTION_CLAUSE[partnerRole]})`.slice(0, PERSONA_COLUMN_MAX_LENGTH);

const buildMissionSetupLines = (setup: MissionSetupContext): string[] => [
  `- 장소/환경: ${ENVIRONMENT_LABEL[setup.environment]}`,
  `- 상대방과의 관계: ${PARTNER_ROLE_LABEL[setup.partnerRole]}`,
  `- 상대방 성별: ${PARTNER_GENDER_LABEL[setup.partnerGender]}`,
  `- 상대방 나이대: ${PARTNER_AGE_GROUP_LABEL[setup.partnerAgeGroup]}`,
  `- 친밀도: ${INTIMACY_LABEL[setup.intimacyLevel] ?? "보통 사이"}`,
  `- 말투 수준: ${FORMALITY_LABEL[setup.formalityLevel] ?? "보통 존댓말"}`,
];

// 미션 상황에 맞는 배역과 사용자 과제를 한 번에 만든다.
// missionSetup이 있으면 사용자가 고른 상황 설정(관계/친밀도/말투 등)을 반영해 더 구체적으로 잡는다.
// 실패해도 예외를 던지지 않는다 — 대화 시작 자체가 막히면 안 되므로 null로 진행한다.
export const generateRoleSetup = async (
  missionTitle: string,
  missionDescription: string | null,
  missionSetup?: MissionSetupContext | null
): Promise<RoleSetup> => {
  const contextLines = [
    `미션 제목: ${missionTitle}`,
    missionDescription ? `미션 설명: ${missionDescription}` : null,
  ].filter((line): line is string => line !== null);

  if (missionSetup) {
    contextLines.push("", "사용자가 고른 상황 설정:", ...buildMissionSetupLines(missionSetup));
  }

  const result = await callUpstageChat(
    [
      {
        role: "system",
        content: [
          "당신은 대화 연습 앱의 역할극 설정을 잡는 도우미입니다.",
          "주어진 미션에 대해 두 가지를 정하세요.",
          "",
          "1) persona — 사용자의 대화 상대가 될 인물.",
          '   나이대/관계/말투가 드러나는 짧은 한 줄. 예: "동아리 1년차 선배, 친근한 존댓말"',
          "   이름은 짓지 않습니다.",
          "   '사용자가 고른 상황 설정'이 주어졌다면 그 관계·성별·나이대·친밀도·말투 수준을",
          "   반드시 반영해서 배역을 잡으세요. 주어지지 않았다면 미션 상황에 맞게 자유롭게 정하세요.",
          "",
          "2) userTask — 이 미션에서 **사용자가** 해내야 할 행동.",
          "   미션 설명은 사용자에게 하는 지시문이므로, 그 핵심 행동을 명사형 한 줄로 바꿔 씁니다.",
          '   예: 미션이 "인상 깊은 장면을 설명해 보세요"면 → "자기가 본 영화의 인상 깊은 장면을 설명하기"',
          '   예: 미션이 "관심사를 물어보세요"면 → "상대에게 관심사를 질문하기"',
          "",
          `- 각 항목은 ${ROLE_SETUP_MAX_LENGTH}자 이내 한 줄입니다.`,
          "- 반드시 아래 JSON 형식으로만 응답하세요.",
          '{ "persona": "string", "userTask": "string" }',
        ].join("\n"),
      },
      { role: "user", content: `${contextLines.join("\n")}\n\n이 미션의 배역과 사용자 과제를 정해주세요.` },
    ],
    { temperature: 0.7, maxTokens: ROLE_SETUP_MAX_TOKENS, jsonMode: true }
  );

  if (!result.ok) {
    logger.warn({ reason: result.reason }, "배역 설정 LLM 호출 실패 — 배역 없이 진행");
    return { persona: null, userTask: null };
  }
  const roleSetup = parseRoleSetup(result.content);
  if (!roleSetup.persona || !missionSetup) return roleSetup;

  return { ...roleSetup, persona: applyPartnerRoleDirection(roleSetup.persona, missionSetup.partnerRole) };
};
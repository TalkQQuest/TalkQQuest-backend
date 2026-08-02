// modules/conversations/services/conversation-role.service.ts
//
// 세션 생성 시 1회 실행 — 이 대화에서 AI가 맡을 배역과 "사용자가 해야 할 일"을 정한다.
// 두 값 모두 Conversations에 저장돼 매 턴 프롬프트에 주입되므로, 여기서 잘못 잡으면
// 대화 전체가 어긋난다. 형식이 어긋나면 저장하지 않고 null로 두는 편이 낫다.

import { z } from "zod";
import { callUpstageChat, parseJsonResponse } from "../../../shared/ai";
import { logger } from "../../../config/logger";

// ── 배역·과제 설정 (세션 생성 시 1회) ──
// 미션 제목만으로는 매 턴 다른 사람이 말하는 것처럼 흔들려서, 배역을 한 번 정해 굳힌다.
// 동시에 "사용자가 해야 할 일"도 한 줄로 뽑는다 — Missions.description은 "…해 보세요"처럼
// 사용자에게 하는 명령문이라, 그대로 두면 AI가 자기 지시로 읽고 과제를 먼저 수행해버린다.

const ROLE_SETUP_MAX_TOKENS = 200;
const ROLE_SETUP_MAX_LENGTH = 100; // 두 컬럼 모두 VARCHAR(255)라 넉넉히 잡아도 안전

export interface RoleSetup {
  persona: string | null;
  userTask: string | null;
}

const roleSetupSchema = z.object({
  persona: z.string().min(1).max(ROLE_SETUP_MAX_LENGTH),
  userTask: z.string().min(1).max(ROLE_SETUP_MAX_LENGTH),
});

// 배역·과제는 매 턴 프롬프트에 들어가므로 여기에 잡소리가 섞이면 모든 턴이 오염된다.
// 형식이 어긋나면 저장하지 않고 null로 둔다(그 경우 일반 규칙만 적용된다).
const parseRoleSetup = (raw: string): RoleSetup => {
  const parsed = parseJsonResponse(raw, roleSetupSchema, "배역 설정");
  if (!parsed) return { persona: null, userTask: null };

  // 여러 줄이 섞여 들어오면 첫 줄만 쓴다.
  return {
    persona: parsed.persona.split("\n")[0].trim(),
    userTask: parsed.userTask.split("\n")[0].trim(),
  };
};

// 미션 상황에 맞는 배역과 사용자 과제를 한 번에 만든다.
// 실패해도 예외를 던지지 않는다 — 대화 시작 자체가 막히면 안 되므로 null로 진행한다.
export const generateRoleSetup = async (
  missionTitle: string,
  missionDescription: string | null
): Promise<RoleSetup> => {
  const context = missionDescription
    ? `미션 제목: ${missionTitle}\n미션 설명: ${missionDescription}`
    : `미션 제목: ${missionTitle}`;

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
      { role: "user", content: `${context}\n\n이 미션의 배역과 사용자 과제를 정해주세요.` },
    ],
    { temperature: 0.7, maxTokens: ROLE_SETUP_MAX_TOKENS, jsonMode: true }
  );

  if (!result.ok) {
    logger.warn({ reason: result.reason }, "배역 설정 LLM 호출 실패 — 배역 없이 진행");
    return { persona: null, userTask: null };
  }
  return parseRoleSetup(result.content);
};
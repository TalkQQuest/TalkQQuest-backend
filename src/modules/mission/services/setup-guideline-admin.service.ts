// modules/mission/services/setup-guideline-admin.service.ts
//
// Missions.setup_guideline 단독 재생성 (운영·백필용).
//
// LLM 추천으로 만들어지는 미션(is_template=false)은 생성 시점에 setup_guideline이 함께 채워지지만,
// 시드로 들어간 템플릿 미션(is_template=true)은 #148-150 이전부터 있던 데이터라 이 컬럼이 비어 있다.
// 그 결과 GET /missions, GET /missions/{missionId}가 템플릿 미션에 대해 항상 setupGuideline: null을
// 반환한다 — 이 서비스는 그 값을 나중에 채우거나(백필) 다시 만드는 용도다.
//
// ⚠️ playbook-admin.service.ts와 같은 이유로 관리자 역할이 없어 인증만 통과하면 호출할 수 있다.
//    운영 배포 전 권한 게이트를 반드시 추가할 것.

import * as missionRepository from "../repositories/mission.repository";
import { MissionNotFoundError, SetupGuidelineGenerationFailedError } from "../errors/mission.error";
import { generateSetupGuidelineForMission } from "./llm.service";
import { SetupGuidelineDto } from "../dtos/mission.dto";

export interface SetupGuidelineRegenerateResponse {
  missionId: string;
  setupGuideline: SetupGuidelineDto;
}

// LLM으로 새로 만들어 덮어쓴다. 미션 본문(title/description/category/difficulty)은 바꾸지 않는다.
// 여기서는 실패를 조용히 넘기지 않는다 — 운영자가 의도적으로 요청한 작업이므로 실패 사실을 알려야 한다
// (자동 생성 경로와 다른 점).
export const regenerateSetupGuideline = async (
  missionId: string
): Promise<SetupGuidelineRegenerateResponse> => {
  const mission = await missionRepository.findMissionById(missionId);
  if (!mission) throw new MissionNotFoundError();

  const guideline = await generateSetupGuidelineForMission({
    title: mission.title,
    description: mission.description,
    category: mission.category,
    difficulty: mission.difficulty,
  });
  if (!guideline) throw new SetupGuidelineGenerationFailedError();

  await missionRepository.updateMissionSetupGuideline(missionId, guideline);

  return { missionId, setupGuideline: guideline };
};

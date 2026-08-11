// modules/mission/services/playbook-admin.service.ts
//
// 대화 플레이북 CRUD (운영·튜닝용).
//
// 플레이북은 첫 대화 시작 시 자동 생성되지만, LLM이 만든 것이라 품질이 들쭉날쭉하다.
// 눈으로 보고 고칠 수단이 필요해 별도로 뺐다 — 생성·매칭 로직(playbook.service)과
// 성격이 달라서 파일을 나눈다.
//
// ⚠️ 플레이북은 **미션 단위로 모든 사용자가 공유**하는 데이터다. 한 명이 고치면 그 미션으로
//    대화하는 모두에게 적용된다. 현재 프로젝트에 관리자 역할이 없어 인증만 통과하면 쓸 수 있으니,
//    운영 배포 전에 권한 게이트를 반드시 추가할 것.

import * as missionRepository from "../repositories/mission.repository";
import {
  MissionNotFoundError,
  PlaybookGenerationFailedError,
  PlaybookNotFoundError,
} from "../errors/mission.error";
import {
  embedPlaybook,
  generatePlaybook,
  parseStoredPlaybook,
  toPlaybookMissionContext,
  toPlaybookView,
  PlaybookInput,
  PlaybookView,
} from "./playbook.service";

export interface PlaybookResponse {
  missionId: string;
  playbook: PlaybookView;
  updatedAt: string;
}

const assertMissionExists = async (missionId: string): Promise<void> => {
  const mission = await missionRepository.findMissionById(missionId);
  if (!mission) throw new MissionNotFoundError();
};

// 저장된 플레이북을 읽어 응답 형태로 만든다. 형식이 깨져 있으면 없는 것으로 본다
// (다음 대화 시작 때 어차피 재생성된다).
export const getPlaybook = async (missionId: string): Promise<PlaybookResponse> => {
  await assertMissionExists(missionId);

  const row = await missionRepository.findPlaybookByMissionId(missionId);
  const parsed = row ? parseStoredPlaybook(row.data) : null;
  if (!row || !parsed) throw new PlaybookNotFoundError();

  return {
    missionId,
    playbook: toPlaybookView(parsed),
    updatedAt: row.updated_at.toISOString(),
  };
};

// 사람이 고친 내용으로 통째로 교체한다.
// **텍스트가 바뀌었으므로 임베딩을 반드시 다시 만든다** — 옛 임베딩을 남기면 매칭이
// 조용히 어긋나고, 겉으로는 정상이라 알아채기 어렵다.
export const replacePlaybook = async (
  missionId: string,
  input: PlaybookInput
): Promise<PlaybookResponse> => {
  await assertMissionExists(missionId);

  const embedded = await embedPlaybook(input);
  const saved = await missionRepository.upsertPlaybook(missionId, embedded);

  return {
    missionId,
    playbook: toPlaybookView(embedded),
    updatedAt: saved.updated_at.toISOString(),
  };
};

// LLM으로 새로 만들어 덮어쓴다. 자동 생성 결과가 마음에 안 들 때 쓴다.
export const regeneratePlaybook = async (missionId: string): Promise<PlaybookResponse> => {
  const mission = await missionRepository.findMissionById(missionId);
  if (!mission) throw new MissionNotFoundError();

  const generated = await generatePlaybook(toPlaybookMissionContext(mission));
  // 여기서는 실패를 조용히 넘기지 않는다 — 사용자가 의도적으로 요청한 작업이므로
  // 실패했다는 사실을 알려줘야 한다(자동 생성 경로와 다른 점).
  if (!generated) throw new PlaybookGenerationFailedError();

  const saved = await missionRepository.upsertPlaybook(missionId, generated);
  return {
    missionId,
    playbook: toPlaybookView(generated),
    updatedAt: saved.updated_at.toISOString(),
  };
};

// 삭제. 다음 대화 시작 시 자동 재생성되므로 "초기화"에 가깝다.
export const deletePlaybook = async (missionId: string): Promise<void> => {
  await assertMissionExists(missionId);

  const { count } = await missionRepository.deletePlaybook(missionId);
  if (count === 0) throw new PlaybookNotFoundError();
};

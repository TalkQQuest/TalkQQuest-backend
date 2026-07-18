// 레벨 시스템의 단일 출처(single source of truth).
//
// 이 공식은 두 곳이 반드시 같은 값을 봐야 한다:
//  - 미션 완료 시 레벨업 판정 (mission/services/mission-completion.service.ts)
//  - GET /xp/summary의 nextLevelXp (xp/services/xp.service.ts)
// 값이 어긋나면 "진행바는 꽉 찼는데 레벨업이 안 되는" 버그가 나므로, 각자 복사하지 말고
// 반드시 이 함수를 import해서 쓴다.
//
// TODO: 레벨업 필요 XP 미확정 — level * 100으로 가정 (기획 확정 시 이 함수만 수정하면 된다)

export const calculateNextLevelXp = (level: number): number => level * 100;

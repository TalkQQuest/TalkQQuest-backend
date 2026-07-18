import { prisma } from "../../../config/database";
import { ValidationError, NotFoundError } from "../../../shared/errors/common.error";
import { MissionNotFoundError } from "../errors/mission.error";
import * as missionRepository from "../repositories/mission.repository";
import * as missionCompletionRepository from "../repositories/mission-completion.repository";
import {
  CompleteConversationRequestDto,
  CompleteConversationResponseDto,
} from "../dtos/mission-completion.dto";
// 레벨 공식은 xp 모듈이 소유한다 — GET /xp/summary의 nextLevelXp와 반드시 같은 값을 써야 하므로
// 여기서 따로 정의하지 않고 import한다 (xp/services/level.service.ts).
import { calculateNextLevelXp } from "../../xp/services/level.service";

export const completeConversation = async (
  userId: string,
  conversationId: string,
  body: CompleteConversationRequestDto
): Promise<CompleteConversationResponseDto> => {
  const conversation = await missionCompletionRepository.findConversationByIdAndUser(
    conversationId,
    userId
  );
  if (!conversation) throw new MissionNotFoundError("존재하지 않는 미션 또는 대화입니다.");

  if (conversation.status !== "in_progress") {
    throw new ValidationError("이미 종료 처리된 대화입니다.");
  }

  const mission = await missionRepository.findMissionById(conversation.mission_id);
  if (!mission) throw new MissionNotFoundError("존재하지 않는 미션 또는 대화입니다.");

  // TODO: 결과별 XP 지급 규칙 미확정 — success만 전액 지급, failure/avoidance는 0으로 가정
  const xpEarned = body.result === "success" ? mission.reward_xp : 0;

  return prisma.$transaction(async (tx) => {
    const record = await missionCompletionRepository.createMissionRecord(
      {
        user: { connect: { id: userId } },
        mission: { connect: { id: mission.id } },
        conversation: { connect: { id: conversationId } },
        result: body.result,
        memo: body.memo,
        duration_minutes: body.durationMinutes,
        emotion: body.emotion,
        xp_earned: xpEarned,
        status: "completed",
        completed_at: new Date(),
      },
      tx
    );

    await missionCompletionRepository.markConversationCompleted(conversationId, tx);

    if (xpEarned > 0) {
      const profile = await missionCompletionRepository.findProfileForUpdate(userId, tx);
      if (!profile) throw new NotFoundError("사용자를 찾을 수 없습니다.");

      await missionCompletionRepository.createXpHistory(
        {
          user: { connect: { id: userId } },
          amount: xpEarned,
          reason: "미션 완료",
          reference_id: record.id,
          reference_type: "mission_record",
        },
        tx
      );

      let level = profile.level;
      let xp = profile.xp + xpEarned;
      let threshold = calculateNextLevelXp(level);
      while (xp >= threshold) {
        xp -= threshold;
        level += 1;
        threshold = calculateNextLevelXp(level);
      }

      await missionCompletionRepository.updateProfileXpAndLevel(userId, { xp, level }, tx);
    }

    return {
      missionRecordId: record.id,
      status: "completed",
      xpEarned,
      completedAt: record.completed_at!.toISOString(),
    };
  });
};
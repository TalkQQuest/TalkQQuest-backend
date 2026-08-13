import { Prisma } from "@prisma/client";
import { prisma } from "../../../config/database";

type TxClient = Prisma.TransactionClient;

// conversation 조회/상태 변경 (미션 완료 처리 전용)
export const findConversationByIdAndUser = (
  conversationId: string,
  userId: string
) =>
  prisma.conversations.findFirst({
    where: { id: conversationId, user_id: userId },
    include: { messages: { select: { role: true, content: true } } },
  });

export const markConversationCompleted = (
  conversationId: string,
  tx: TxClient
) =>
  tx.conversations.update({
    where: { id: conversationId },
    data: { status: "completed", finished_at: new Date() },
  });

// conversation.repository.ts의 finishConversation과 동일한 아카이브 등록을
// 미션 완료 트랜잭션 안에서도 수행한다 (#102 — complete만 호출해도 보관함에 남아야 함).
// 이 경로로 도달하는 시점엔 이미 conversation.status === "in_progress"임이 서비스에서 검증된
// 뒤라 중복 생성될 일은 없지만, finishConversation과 동일하게 방어적으로 존재 여부를 먼저 확인한다.
export const archiveConversationIfMissing = async (
  userId: string,
  conversationId: string,
  tx: TxClient
) => {
  const existing = await tx.archive_Items.findFirst({
    where: { user_id: userId, item_type: "conversation", reference_id: conversationId },
    select: { id: true },
  });

  if (!existing) {
    await tx.archive_Items.create({
      data: { user_id: userId, item_type: "conversation", reference_id: conversationId },
    });
  }
};

// mission record / xp / level 갱신
export const createMissionRecord = (
  data: Prisma.Mission_RecordsCreateInput,
  tx: TxClient
) => tx.mission_Records.create({ data });

export const createXpHistory = (
  data: Prisma.XP_HistoryCreateInput,
  tx: TxClient
) => tx.xP_History.create({ data });

export const findProfileForUpdate = (userId: string, tx: TxClient) =>
  tx.user_Profiles.findUnique({ where: { user_id: userId } });

export const updateProfileXpAndLevel = (
  userId: string,
  data: { xp: number; level: number },
  tx: TxClient
) =>
  tx.user_Profiles.update({
    where: { user_id: userId },
    data: { xp: data.xp, level: data.level },
  });
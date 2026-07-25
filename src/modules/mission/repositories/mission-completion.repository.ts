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
  });

export const markConversationCompleted = (
  conversationId: string,
  tx: TxClient
) =>
  tx.conversations.update({
    where: { id: conversationId },
    data: { status: "completed", finished_at: new Date() },
  });

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
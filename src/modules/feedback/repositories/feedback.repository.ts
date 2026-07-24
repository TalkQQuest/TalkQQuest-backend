import { prisma } from "../../../config/database";

export const findFeedbackByIdAndUserId = (feedbackId: string, userId: string) =>
  prisma.feedbacks.findFirst({
    where: { id: feedbackId, user_id: userId },
    include: { conversation: { select: { selected_topic: true } } },
  });

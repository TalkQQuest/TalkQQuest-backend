import cron from "node-cron";
import { logger } from "../../../config/logger";
import { findUsersForMissionReminder } from "../repositories/notification.repository";
import { notifyUser } from "./notification.service";

// 매 분 "지금 KST 기준 몇 시 몇 분인지"를 mission_reminder_time("HH:mm")과 비교해,
// 일치하는 유저에게 미션 리마인드 알림/푸시를 보낸다. 서버가 단일 인스턴스로 배포되므로
// 중복 발송 방지(락 등)는 별도로 구현하지 않는다.
const sendMissionReminders = async (): Promise<void> => {
  const now = new Date();
  const hhmm = now.toLocaleTimeString("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit" });

  const targets = await findUsersForMissionReminder(hhmm);
  if (targets.length === 0) return;

  await Promise.all(
    targets.map(async ({ user_id }) => {
      try {
        await notifyUser(user_id, "mission_reminder", "오늘의 미션을 시작해보세요!", "설정한 시간이 되었어요. 오늘의 대화 미션을 확인해보세요.");
      } catch (error) {
        logger.warn({ err: error, userId: user_id }, "미션 리마인드 발송 실패");
      }
    })
  );
};

export const startMissionReminderScheduler = (): void => {
  cron.schedule(
    "* * * * *",
    // 콜백이 Promise를 반환해야 noOverlap이 "현재 실행 중인지"를 정확히 추적한다 —
    // 실행이 1분을 넘겨도 다음 tick이 겹쳐 돌지 않도록 막는다.
    () =>
      sendMissionReminders().catch((error) => {
        logger.warn({ err: error }, "미션 리마인드 스케줄러 실행 중 예기치 못한 오류");
      }),
    { timezone: "Asia/Seoul", noOverlap: true }
  );

  logger.info("미션 리마인드 스케줄러 시작 (매 분, Asia/Seoul)");
};

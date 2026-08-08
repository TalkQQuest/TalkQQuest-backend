-- 성장 프로필(User_Growth_Profiles) 추가
--
-- 지난 대화·피드백에서 뽑아낸 요약을 사용자당 1행으로 보관한다. 미션 추천은 이 한 행만 읽고,
-- 원문(Conversations / Conversation_Messages / Feedbacks)은 요약을 만들 때만 읽는다.
--
-- 신규 테이블만 추가하므로 기존 데이터에 영향이 없다. 행이 없는 사용자(= 아직 피드백이 없거나
-- 요약 배치가 아직 돌지 않은 사용자)는 기존 규칙 기반 추천 경로를 그대로 탄다.
--
-- 참고: `prisma migrate diff`가 함께 뱉는 여러 테이블의
-- `MODIFY updated_at TIMESTAMP(0) ... ON UPDATE CURRENT_TIMESTAMP`는 baseline과 정의가
-- 동일한 no-op이라 의도적으로 뺐다.

-- CreateTable
CREATE TABLE `User_Growth_Profiles` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `summary` TEXT NULL,
    `strengths` JSON NULL,
    `improvements` JSON NULL,
    `struggle_situations` JSON NULL,
    `metric_averages` JSON NULL,
    `suggested_difficulty` TINYINT NULL,
    `reflected_feedback_count` INTEGER NOT NULL DEFAULT 0,
    `last_feedback_id` CHAR(36) NULL,
    `last_reflected_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE INDEX `User_Growth_Profiles_user_id_key`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `User_Growth_Profiles` ADD CONSTRAINT `User_Growth_Profiles_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `Users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

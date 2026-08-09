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
    PRIMARY KEY (`id`),

    -- 난이도는 1(쉬움)~3(어려움). 미설정 상태를 구분해야 하므로 NULL은 허용한다.
    -- Prisma 스키마로는 표현할 수 없어 마이그레이션에 직접 쓴다(Prisma는 CHECK를 드리프트로 잡지 않음).
    CONSTRAINT `User_Growth_Profiles_suggested_difficulty_range` CHECK (`suggested_difficulty` IS NULL OR `suggested_difficulty` BETWEEN 1 AND 3)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `User_Growth_Profiles` ADD CONSTRAINT `User_Growth_Profiles_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `Users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- 성장 프로필의 증분 갱신 커서가 가리킬 지점.
-- Feedbacks는 pending으로 먼저 생성되고 나중에 ready가 되므로, created_at으로는
-- "여기까지 반영했다"를 표현할 수 없다(뒤늦게 ready가 된 피드백이 커서보다 앞서 영영 누락된다).
-- AlterTable
ALTER TABLE `Feedbacks` ADD COLUMN `ready_at` DATETIME(3) NULL;

-- 이미 ready인 기존 행을 created_at으로 백필한다.
-- 백필하지 않으면 이 행들은 ready_at이 NULL이라 커서 조회에서 통째로 빠지고, 그걸 피하려고
-- 집계 쪽에 COALESCE 분기를 두면 커서 의미가 두 갈래로 갈린다. 여기서 한 번 채워 없앤다.
-- 과거 ready 전환 시각은 남아 있지 않으므로 created_at이 가장 가까운 근사값이며,
-- 커서는 순서만 지키면 되므로 이 근사로 충분하다.
UPDATE `Feedbacks` SET `ready_at` = `created_at` WHERE `status` = 'ready' AND `ready_at` IS NULL;

-- CreateIndex
CREATE INDEX `Feedbacks_user_id_ready_at_idx` ON `Feedbacks`(`user_id`, `ready_at`);

-- 미션 준비 정보(Mission_Setups) 추가 + 미션 창 옵션 가이드라인(Missions.setup_guideline)
--
-- Missions 1:N Mission_Setups 1:N Conversations 로 연결한다.
-- 기존 대화는 mission_setup_id가 NULL로 남고(설정 없이 시작한 대화), 기존 미션은
-- setup_guideline이 NULL로 남는다 — 두 경우 모두 예전 경로가 그대로 동작해야 한다.
--
-- 참고: `prisma migrate diff`가 함께 뱉는 여러 테이블의
-- `MODIFY updated_at TIMESTAMP(0) ... ON UPDATE CURRENT_TIMESTAMP`는 baseline과 정의가
-- 동일한 no-op(= Prisma가 dbgenerated를 왕복하며 생기는 노이즈)이라 의도적으로 뺐다.

-- AlterTable
ALTER TABLE `Missions` ADD COLUMN `setup_guideline` JSON NULL;

-- CreateTable
CREATE TABLE `Mission_Setups` (
    `id` CHAR(36) NOT NULL,
    `mission_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `environment` ENUM('school', 'workplace', 'daily_place', 'community', 'online') NOT NULL,
    `partner_role` ENUM('friend', 'senior', 'junior', 'peer', 'other') NOT NULL,
    `partner_gender` ENUM('male', 'female') NOT NULL,
    `partner_age_group` ENUM('teens', 'twenties', 'thirties', 'forties', 'fifties', 'sixties_plus') NOT NULL,
    `intimacy_level` TINYINT NOT NULL,
    `formality_level` TINYINT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Mission_Setups_mission_id_idx`(`mission_id`),
    INDEX `Mission_Setups_user_id_mission_id_created_at_idx`(`user_id`, `mission_id`, `created_at`),
    PRIMARY KEY (`id`),

    -- 친밀도·예절 수준은 1~5단계다. TINYINT만으로는 -128~127을 허용하므로 범위를 DB에서도 막는다.
    -- Prisma 스키마로는 표현할 수 없어(지원하지 않음) 마이그레이션에 직접 쓴다. Prisma는 CHECK를
    -- 인식하지 않으므로 migrate diff가 이걸 드리프트로 잡지 않는다.
    -- MySQL 8.0.16 이상에서만 강제된다(그 미만은 파싱 후 무시). 로컬·CI 모두 mysql:8이라 충족.
    -- 애플리케이션 쓰기 경로(POST /missions/{missionId}/setups)에서도 같은 범위를 검증한다.
    CONSTRAINT `Mission_Setups_intimacy_level_range` CHECK (`intimacy_level` BETWEEN 1 AND 5),
    CONSTRAINT `Mission_Setups_formality_level_range` CHECK (`formality_level` BETWEEN 1 AND 5)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Mission_Setups` ADD CONSTRAINT `Mission_Setups_mission_id_fkey` FOREIGN KEY (`mission_id`) REFERENCES `Missions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Mission_Setups` ADD CONSTRAINT `Mission_Setups_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `Users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE `Conversations` ADD COLUMN `mission_setup_id` CHAR(36) NULL;

-- CreateIndex
CREATE INDEX `Conversations_mission_setup_id_idx` ON `Conversations`(`mission_setup_id`);

-- AddForeignKey
ALTER TABLE `Conversations` ADD CONSTRAINT `Conversations_mission_setup_id_fkey` FOREIGN KEY (`mission_setup_id`) REFERENCES `Mission_Setups`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

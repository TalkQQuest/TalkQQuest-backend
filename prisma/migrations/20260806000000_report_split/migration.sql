-- 성장 리포트 / 주간 비교 리포트 재분리 (#145).
--
-- #112에서 통합했던 Reports(growth+weeklyCompare)를 다시 분리한다.
-- 성장 리포트는 이제 "대화 단위"로 저장되므로(conversation_id, 같은 대화로 중복 저장 방지),
-- 기존에 쌓여있던 통합 리포트 데이터는 새 구조와 호환되지 않는다. 개발 단계 데이터이므로
-- 마이그레이션하지 않고 정리한다. Archive_Items는 report 외 다른 타입도 함께 들어있는
-- 공용 테이블이라 item_type = 'report'인 행만 지운다(테이블 전체를 비우지 않는다).
DELETE FROM `Reports`;
DELETE FROM `Archive_Items` WHERE `item_type` = 'report';

-- AlterTable
ALTER TABLE `Archive_Items` MODIFY `item_type` ENUM('conversation', 'phrase', 'report', 'mission', 'weekly_compare') NOT NULL;

-- CreateTable
CREATE TABLE `Weekly_Compare_Reports` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `week_index` INTEGER NOT NULL,
    `data` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Weekly_Compare_Reports_user_id_idx`(`user_id`),
    UNIQUE INDEX `Weekly_Compare_Reports_user_id_week_index_key`(`user_id`, `week_index`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable (Reports 테이블을 위에서 비웠으므로 NOT NULL 컬럼을 바로 추가할 수 있다)
ALTER TABLE `Reports` ADD COLUMN `conversation_id` CHAR(36) NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX `Reports_conversation_id_key` ON `Reports`(`conversation_id`);

-- AddForeignKey
ALTER TABLE `Reports` ADD CONSTRAINT `Reports_conversation_id_fkey` FOREIGN KEY (`conversation_id`) REFERENCES `Conversations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Weekly_Compare_Reports` ADD CONSTRAINT `Weekly_Compare_Reports_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `Users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- 아래는 이번 기능과 무관한 기존 드리프트 정리(baseline 생성 당시 detect된 updated_at 컬럼
-- DEFAULT/ON UPDATE 절 표기 차이, 동작 변화 없음). 별도 마이그레이션으로 두지 않고 여기 합쳤다.
ALTER TABLE `Archive_Folders` MODIFY `updated_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;
ALTER TABLE `Auth_Identities` MODIFY `updated_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;
ALTER TABLE `Community_Join_Requests` MODIFY `updated_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;
ALTER TABLE `Goals` MODIFY `updated_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;
ALTER TABLE `Mission_Playbooks` MODIFY `updated_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;
ALTER TABLE `Notification_Settings` MODIFY `updated_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;
ALTER TABLE `Usage` MODIFY `updated_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;
ALTER TABLE `User_Profiles` MODIFY `updated_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

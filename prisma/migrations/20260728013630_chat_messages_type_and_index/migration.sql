-- #115: 실시간 채팅에 필요한 Chat_Messages 보강.
-- - type(text|system) 추가: 멤버 승인 시 "OOO님이 입장했습니다" 같은 시스템 메시지 표시용.
-- - user_id를 nullable로 변경: 시스템 메시지는 특정 발화자가 없다.
-- - (community_id, created_at) 복합 인덱스 추가: 채팅 이력 커서 페이지네이션 성능용.
--
-- community_id_fkey가 Chat_Messages_community_id_idx에 의존하고 있어, 대체 인덱스를 먼저
-- 만들어야 그 인덱스를 지울 수 있다(MySQL은 FK 컬럼에 인덱스를 요구한다). 새 복합 인덱스는
-- community_id가 선두라 FK 요구를 그대로 만족시킨다. Usage_user_id_period_key를 교체할 때와
-- 같은 순서다(20260722121358_usage_rolling_cycle).

-- CreateIndex
CREATE INDEX `Chat_Messages_community_id_created_at_idx` ON `Chat_Messages`(`community_id`, `created_at`);

-- DropIndex
DROP INDEX `Chat_Messages_community_id_idx` ON `Chat_Messages`;

-- DropForeignKey
ALTER TABLE `Chat_Messages` DROP FOREIGN KEY `Chat_Messages_user_id_fkey`;

-- AlterTable
ALTER TABLE `Chat_Messages`
  MODIFY `user_id` CHAR(36) NULL,
  ADD COLUMN `type` ENUM('text', 'system') NOT NULL DEFAULT 'text';

-- AddForeignKey
ALTER TABLE `Chat_Messages` ADD CONSTRAINT `Chat_Messages_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `Users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

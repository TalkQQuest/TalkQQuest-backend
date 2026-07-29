-- #115: 실시간 채팅에 필요한 Chat_Messages 보강.
-- - type(text|system) 추가: 멤버 승인 시 "OOO님이 입장했습니다" 같은 시스템 메시지 표시용.
-- - user_id를 nullable로 변경: 시스템 메시지는 특정 발화자가 없다.
-- - (community_id, created_at) 복합 인덱스 추가: 채팅 이력 커서 페이지네이션 성능용.

-- DropForeignKey
ALTER TABLE `Chat_Messages` DROP FOREIGN KEY `Chat_Messages_user_id_fkey`;

-- DropIndex
DROP INDEX `Chat_Messages_community_id_idx` ON `Chat_Messages`;

-- AlterTable
ALTER TABLE `Chat_Messages`
  MODIFY `user_id` CHAR(36) NULL,
  ADD COLUMN `type` ENUM('text', 'system') NOT NULL DEFAULT 'text';

-- CreateIndex
CREATE INDEX `Chat_Messages_community_id_created_at_idx` ON `Chat_Messages`(`community_id`, `created_at`);

-- AddForeignKey
ALTER TABLE `Chat_Messages` ADD CONSTRAINT `Chat_Messages_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `Users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Admin_Users 추가 (#208) — 관리자 전용 엔드포인트(playbook CRUD, setup-guideline/regenerate)
-- 권한 체크용.
--
-- Users에 role 컬럼을 넣는 대신 별도 테이블로 뺀 이유: admin은 소수의 예외적 상태라, 모든 유저
-- 조회에 항상 딸려오는 컬럼보다 "행이 있으면 admin"이 더 단순하고, 회원가입 흐름(Users insert)을
-- admin 여부와 완전히 분리할 수 있다.
--
-- 신규 테이블만 추가하므로 기존 데이터에 영향이 없다.
--
-- 참고: `prisma migrate diff`가 함께 뱉는 다른 테이블들의
-- `MODIFY updated_at TIMESTAMP(0) ... ON UPDATE CURRENT_TIMESTAMP`, `Feedbacks_conversation_id_key`,
-- `Notification_Settings` 인덱스 RENAME은 이 변경과 무관한 기존 drift라 의도적으로 뺐다
-- (User_Growth_Profiles 마이그레이션 때와 동일한 처리).

-- CreateTable
CREATE TABLE `Admin_Users` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `granted_by` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Admin_Users_user_id_key`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Admin_Users` ADD CONSTRAINT `Admin_Users_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `Users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Admin_Users` ADD CONSTRAINT `Admin_Users_granted_by_fkey` FOREIGN KEY (`granted_by`) REFERENCES `Users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

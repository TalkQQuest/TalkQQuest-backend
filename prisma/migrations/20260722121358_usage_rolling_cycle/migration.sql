-- AlterTable: 달력 월(YYYY-MM) 문자열 대신, 가입일/구독 시작일 기준 롤링 1개월 주기의 시작일(DATE)로 변경
-- user_id FK가 기존 (user_id, period) 유니크 인덱스에 의존하고 있어, 먼저 대체 인덱스를 만들어야 그 인덱스를 지울 수 있다.
ALTER TABLE `Usage` ADD INDEX `Usage_user_id_idx` (`user_id`);
ALTER TABLE `Usage` DROP INDEX `Usage_user_id_period_key`;
ALTER TABLE `Usage` DROP COLUMN `period`,
    ADD COLUMN `cycle_start` DATE NOT NULL;
ALTER TABLE `Usage` ADD UNIQUE INDEX `Usage_user_id_cycle_start_key` (`user_id`, `cycle_start`);

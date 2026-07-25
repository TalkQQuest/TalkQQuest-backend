-- Reports 스키마 동기화: PR #70에서 schema.prisma만 바뀌고 마이그레이션이 누락된 부분을 보충한다.
--  1) type ENUM: monthly/weekly → growth/weekly_compare
--     (DB 컬럼이 'weekly_compare'를 몰라 POST /reports 저장 시 Data truncated 오류가 났음)
--  2) period 길이: VARCHAR(10) → VARCHAR(30)
--     (growth 리포트 period가 "YYYY-MM-DD~YYYY-MM-DD"(21자)라 10자 컬럼에서 잘림)

-- AlterTable
ALTER TABLE `Reports` MODIFY `type` ENUM('growth', 'weekly_compare') NOT NULL;

-- AlterTable
ALTER TABLE `Reports` MODIFY `period` VARCHAR(30) NOT NULL;

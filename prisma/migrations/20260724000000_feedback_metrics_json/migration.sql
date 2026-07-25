-- Feedbacks: 지표별 상세를 개별 strengths/improvements 컬럼 대신
-- metrics(JSON 배열 [{key,label,score,strengths,improvements,bestSentence}])로 통일하고,
-- 미션 완료 화면용 mission_summary(JSON string[])를 추가한다.
-- (PR #70에서 schema.prisma만 바뀌고 마이그레이션이 누락되어 여기서 함께 반영)

-- AlterTable
ALTER TABLE `Feedbacks` DROP COLUMN `strengths`,
    DROP COLUMN `improvements`,
    ADD COLUMN `metrics` JSON NULL,
    ADD COLUMN `mission_summary` JSON NULL;

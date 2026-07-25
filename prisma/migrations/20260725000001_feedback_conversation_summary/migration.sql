-- Feedbacks: 대화 전체를 2~3문장으로 요약한 텍스트를 저장할 conversation_summary 추가 (이슈 #83).
-- 피드백 생성 시 요약 칩과 함께 만들어 /archives/conversations/{id}의 summary로 반환한다.

-- AlterTable
ALTER TABLE `Feedbacks` ADD COLUMN `conversation_summary` TEXT NULL;

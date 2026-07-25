-- Feedbacks: 대화 전체를 요약하는 키워드 칩 3개(단어 형태)를 저장할 summary_chips 추가 (이슈 #83).
-- 피드백 생성 시 함께 만들어 conversation 상세(/archives/conversations)·phrase 상세(/archives/phrases)에서 재사용한다.

-- AlterTable
ALTER TABLE `Feedbacks` ADD COLUMN `summary_chips` JSON NULL;

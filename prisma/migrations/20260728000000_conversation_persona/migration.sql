-- Conversations.persona 추가.
--
-- AI가 1턴에 즉흥으로 잡은 배역("1년차 동아리 선배" 등)이 지금까지는 메시지 이력에만 남아 있었다.
-- 프롬프트에 넣는 이력은 최근 10개로 잘리므로, 대화가 길어지면 배역 설정이 창밖으로 밀려나
-- AI가 도우미 말투로 돌아가는 원인이 됐다.
-- 세션 생성 시 배역을 한 번 정해 여기에 저장하고 매 턴 시스템 프롬프트에 주입한다.
--
-- nullable이라 기존 대화에는 영향이 없다(값이 없으면 예전처럼 미션 제목만으로 배역을 잡는다).

-- AlterTable
ALTER TABLE `Conversations` ADD COLUMN `persona` VARCHAR(255) NULL;

-- #112: 성장 리포트와 주간 비교 리포트를 더 이상 별개 타입으로 저장하지 않고 하나로 통합한다.
-- Reports.type 컬럼(및 ReportType enum)을 제거한다. period는 growth 계산 기준 기간을 담고,
-- weekly_compare 계산 기준 기간(weeklyComparePeriod)은 이제 data(Json) 안에만 저장된다.
-- 개발 단계라 기존 저장 데이터는 마이그레이션하지 않고 새 구조로 다시 시드한다.

-- AlterTable
ALTER TABLE `Reports` DROP COLUMN `type`;

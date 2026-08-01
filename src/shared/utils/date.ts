// 대화 소요 시간(분) 계산. 종료 시각이 없으면(진행 중) null. 반올림, 최소 0.
export const durationMinutes = (startedAt: Date, finishedAt: Date | null): number | null => {
  if (!finishedAt) return null;
  const ms = finishedAt.getTime() - startedAt.getTime();
  return Math.max(0, Math.round(ms / 60000));
};

export const addMonths = (date: Date, months: number): Date => {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
};

// ── 날짜(YYYY-MM-DD) 단위 유틸 ──
// "오늘의 미션"처럼 하루를 버킷으로 쓰는 기능용. 서버가 UTC로 떠 있어도 사용자 기준 하루는
// 한국 시간이라, 서버 기본값은 KST로 계산한다.

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// 지금 시각이 속한 KST 날짜를 YYYY-MM-DD로 반환한다.
export const todayInKst = (now: Date = new Date()): string =>
  new Date(now.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);

// YYYY-MM-DD를 UTC 자정 Date로 바꾼다. MySQL DATE 컬럼에 그대로 저장·비교하기 위한 형태라
// 시간대 보정을 하지 않는다(날짜 문자열 ↔ DATE 값이 1:1로 대응해야 한다).
export const toDateOnly = (value: string): Date => new Date(`${value}T00:00:00.000Z`);

// Date(또는 DATE 컬럼 값)를 YYYY-MM-DD 문자열로 되돌린다.
export const fromDateOnly = (value: Date): string => value.toISOString().slice(0, 10);

// YYYY-MM-DD(KST 기준)의 하루 시작을 실제 순간(UTC instant)으로 바꾼다.
// toDateOnly와 달리 시간대를 보정하므로 타임스탬프 컬럼(completed_at 등) 비교에 쓴다.
// 서버가 UTC로 떠 있어도 KST 자정을 정확히 가리킨다.
export const kstDayStart = (date: string): Date => new Date(`${date}T00:00:00+09:00`);

// 두 YYYY-MM-DD 사이의 일수 차이(a - b). 시간대 보정 없이 순수 날짜 차이만 본다.
export const daysBetween = (a: string, b: string): number =>
  Math.round((toDateOnly(a).getTime() - toDateOnly(b).getTime()) / MS_PER_DAY);

// anchor(가입일 또는 구독 시작일)를 기준으로, 지금이 속한 롤링 1개월 주기의 시작일을 계산한다.
// 예: anchor가 7/21이면 주기는 7/21~8/20, 8/21~9/20 ... 식으로 매달 반복된다.
export const getCurrentCycleStart = (anchor: Date, now: Date = new Date()): Date => {
  let cycleStart = new Date(anchor);
  while (addMonths(cycleStart, 1).getTime() <= now.getTime()) {
    cycleStart = addMonths(cycleStart, 1);
  }
  return cycleStart;
};

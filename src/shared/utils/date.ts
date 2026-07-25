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

// anchor(가입일 또는 구독 시작일)를 기준으로, 지금이 속한 롤링 1개월 주기의 시작일을 계산한다.
// 예: anchor가 7/21이면 주기는 7/21~8/20, 8/21~9/20 ... 식으로 매달 반복된다.
export const getCurrentCycleStart = (anchor: Date, now: Date = new Date()): Date => {
  let cycleStart = new Date(anchor);
  while (addMonths(cycleStart, 1).getTime() <= now.getTime()) {
    cycleStart = addMonths(cycleStart, 1);
  }
  return cycleStart;
};

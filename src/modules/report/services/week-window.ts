// 성장/주간비교 리포트가 "지금 이 순간"이 아니라 실제 달력 주(월요일 시작)를 기준으로 계산되도록
// 공용으로 쓰는 주 경계 계산 함수. now 기준 rolling 7일 윈도우를 쓰면 같은 주 안에서도
// 호출 시각에 따라 값이 미묘하게 달라지는 문제가 있어, 반드시 이 함수로 주 경계를 고정한다.
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const addDays = (date: Date, days: number): Date => new Date(date.getTime() + days * MS_PER_DAY);

// 주어진 시각이 속한 주의 월요일 00:00(UTC)을 반환한다.
export const getWeekStart = (date: Date): Date => {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayIndex = (d.getUTCDay() + 6) % 7; // 월=0 ... 일=6
  d.setUTCDate(d.getUTCDate() - dayIndex);
  return d;
};

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

// ── 가입일 기준 주차 (#145, 주간 비교 리포트 전용) ──
// 위 getWeekStart(달력 월요일 기준)와는 별개 개념이다. 성장 리포트의 4주 추세는 계속 달력
// 기준을 쓰고, 주간 비교만 가입일 기준으로 옮긴다 — 둘을 섞으면 안 된다.

// from부터 to까지 꽉 채운 날짜 수(경과일). 예: 정확히 7일 지났으면 7.
export const daysElapsed = (from: Date, to: Date): number =>
  Math.floor((to.getTime() - from.getTime()) / MS_PER_DAY);

// 가입 후 지금까지 완전히 끝난 주가 몇 개인지. 7일 미만이면 0(아직 1주차도 안 끝남).
export const getCompletedWeekCount = (signupAt: Date, now: Date): number =>
  Math.floor(daysElapsed(signupAt, now) / 7);

// 가입일 기준 weekIndex번째 주(1-based)의 [시작, 끝) 구간.
// 1주차 = 가입 후 0~6일, 2주차 = 7~13일 ...
export const getSignupWeekRange = (signupAt: Date, weekIndex: number): { start: Date; end: Date } => {
  const start = addDays(signupAt, (weekIndex - 1) * 7);
  return { start, end: addDays(start, 7) };
};

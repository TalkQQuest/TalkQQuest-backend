import {
  buildHighlights,
  buildMetricChanges,
  computeThisAndLastWeek,
  computeXpChangeRate,
  startOfWeekMonday,
} from "../services/report.service";

describe("startOfWeekMonday", () => {
  it("수요일이 주어지면 그 주 월요일을 반환한다", () => {
    // 2026-07-15는 수요일
    const monday = startOfWeekMonday(new Date("2026-07-15T10:00:00Z"));
    expect(monday.toISOString()).toBe("2026-07-13T00:00:00.000Z");
  });

  it("일요일이 주어지면 그 전 월요일(6일 전)을 반환한다", () => {
    // 2026-07-19는 일요일 → 같은 주의 월요일은 2026-07-13
    const monday = startOfWeekMonday(new Date("2026-07-19T23:00:00Z"));
    expect(monday.toISOString()).toBe("2026-07-13T00:00:00.000Z");
  });

  it("월요일 당일이 주어지면 그날 자정을 반환한다", () => {
    const monday = startOfWeekMonday(new Date("2026-07-13T15:30:00Z"));
    expect(monday.toISOString()).toBe("2026-07-13T00:00:00.000Z");
  });
});

describe("computeThisAndLastWeek", () => {
  it("이번 주는 [월요일, 다음 월요일), 지난 주는 그 앞 7일이다", () => {
    const { thisWeek, lastWeek } = computeThisAndLastWeek(new Date("2026-07-15T10:00:00Z"));

    expect(thisWeek.from.toISOString()).toBe("2026-07-13T00:00:00.000Z");
    expect(thisWeek.to.toISOString()).toBe("2026-07-20T00:00:00.000Z");
    expect(lastWeek.from.toISOString()).toBe("2026-07-06T00:00:00.000Z");
    expect(lastWeek.to.toISOString()).toBe(thisWeek.from.toISOString()); // 경계가 맞닿음(공백/중복 없음)
  });
});

describe("computeXpChangeRate", () => {
  it("일반적인 증가율을 백분율로 계산한다", () => {
    expect(computeXpChangeRate(90, 60)).toBe(50); // (90-60)/60*100
  });

  it("지난 주가 0이고 이번 주도 0이면 0%다", () => {
    expect(computeXpChangeRate(0, 0)).toBe(0);
  });

  it("지난 주가 0이고 이번 주가 0보다 크면 100%로 근사한다", () => {
    expect(computeXpChangeRate(50, 0)).toBe(100);
  });

  it("감소도 음수로 표현한다", () => {
    expect(computeXpChangeRate(30, 60)).toBe(-50);
  });
});

describe("buildMetricChanges", () => {
  it("4개 지표 모두 고정 순서로 from/to/delta를 계산한다", () => {
    const changes = buildMetricChanges(
      { kindness: 88, initiative: 86, empathy: 82, questionLink: 74 },
      { kindness: 92, initiative: 88, empathy: 85, questionLink: 78 }
    );

    expect(changes.map((c) => c.key)).toEqual(["kindness", "initiative", "empathy", "questionLink"]);
    expect(changes[0]).toEqual({ key: "kindness", label: "친절한 태도", from: 88, to: 92, delta: 4 });
  });
});

describe("buildHighlights", () => {
  it("증감폭이 큰 순서로 최대 3개를 생성한다", () => {
    const overallChange = { from: 78, to: 86, delta: 8 };
    const metricChanges = buildMetricChanges(
      { kindness: 88, initiative: 86, empathy: 82, questionLink: 74 },
      { kindness: 92, initiative: 88, empathy: 85, questionLink: 78 }
    );

    const highlights = buildHighlights(overallChange, metricChanges);

    expect(highlights).toHaveLength(3);
    expect(highlights[0]).toContain("전체 점수가 78점에서 86점으로 상승했어요");
  });

  it("변화가 전혀 없으면 빈 배열이다", () => {
    const overallChange = { from: 80, to: 80, delta: 0 };
    const metricChanges = buildMetricChanges(
      { kindness: 80, initiative: 80, empathy: 80, questionLink: 80 },
      { kindness: 80, initiative: 80, empathy: 80, questionLink: 80 }
    );

    expect(buildHighlights(overallChange, metricChanges)).toEqual([]);
  });

  it("하락한 지표도 하이라이트로 다룬다(부정적 문구가 아닌 격려 톤)", () => {
    const overallChange = { from: 80, to: 78, delta: -2 };
    const metricChanges = buildMetricChanges(
      { kindness: 90, initiative: 80, empathy: 80, questionLink: 80 },
      { kindness: 80, initiative: 80, empathy: 80, questionLink: 80 }
    );

    const highlights = buildHighlights(overallChange, metricChanges);
    expect(highlights.some((h) => h.includes("친절한 태도"))).toBe(true);
  });
});

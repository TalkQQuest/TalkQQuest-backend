import { FeedbackSample, LOW_SCORE_THRESHOLD } from "../dtos/growth-profile.dto";
import {
  collectRepeatedTexts,
  collectStruggleSituations,
  computeMetricAverages,
  toFeedbackSample,
} from "../services/growth-aggregate.service";

const sample = (overrides: Partial<FeedbackSample> = {}): FeedbackSample => ({
  feedbackId: "f1",
  readyAt: new Date("2026-08-01T00:00:00Z"),
  scores: { kindness: 80, initiative: 80, empathy: 80, questionLink: 80 },
  conversationSummary: "요약",
  strengths: [],
  improvements: [],
  category: "짧은 대화",
  difficulty: 2,
  environment: "school",
  partnerRole: "senior",
  ...overrides,
});

const row = (overrides: Record<string, unknown> = {}) =>
  ({
    id: "f1",
    ready_at: new Date("2026-08-01T00:00:00Z"),
    kindness_score: 70,
    initiative_score: 60,
    empathy_score: 50,
    question_link_score: 40,
    metrics: [
      { key: "kindness", strengths: ["먼저 인사함"], improvements: ["말끝 흐림"] },
      { key: "empathy", strengths: [], improvements: ["되묻기 부족"] },
    ],
    conversation_summary: "대화 요약",
    conversation: {
      mission: { category: "짧은 대화", difficulty: 2 },
      mission_setup: { environment: "school", partner_role: "senior" },
    },
    ...overrides,
  }) as never;

describe("toFeedbackSample", () => {
  it("피드백 행을 집계 입력으로 평탄화한다", () => {
    const result = toFeedbackSample(row())!;

    expect(result.scores).toEqual({
      kindness: 70,
      initiative: 60,
      empathy: 50,
      questionLink: 40,
    });
    expect(result.category).toBe("짧은 대화");
    expect(result.environment).toBe("school");
    expect(result.partnerRole).toBe("senior");
  });

  it("metrics의 strengths/improvements를 지표 구분 없이 모아 담는다", () => {
    const result = toFeedbackSample(row())!;
    expect(result.strengths).toEqual(["먼저 인사함"]);
    expect(result.improvements).toEqual(["말끝 흐림", "되묻기 부족"]);
  });

  // metrics는 Json 컬럼이라 형식이 깨질 수 있다. 그 한 건 때문에 집계 전체가 죽으면 안 된다.
  it("metrics 형식이 깨져 있어도 빈 배열로 넘어간다", () => {
    const result = toFeedbackSample(row({ metrics: "깨진 값" }))!;
    expect(result.strengths).toEqual([]);
    expect(result.improvements).toEqual([]);
  });

  // Mission_Setups 도입 이전 대화. 상황 축만 비고 나머지는 그대로 쓴다.
  it("준비 정보가 없는 대화는 상황 축이 null이 된다", () => {
    const result = toFeedbackSample(
      row({
        conversation: { mission: { category: "짧은 대화", difficulty: 2 }, mission_setup: null },
      })
    )!;
    expect(result.environment).toBeNull();
    expect(result.partnerRole).toBeNull();
    expect(result.category).toBe("짧은 대화");
  });

  it("ready_at이 없는 행은 제외한다", () => {
    expect(toFeedbackSample(row({ ready_at: null }))).toBeNull();
  });
});

describe("computeMetricAverages", () => {
  it("지표별 평균을 소수 1자리로 낸다", () => {
    const result = computeMetricAverages([
      sample({ scores: { kindness: 70, initiative: 0, empathy: 0, questionLink: 0 } }),
      sample({ scores: { kindness: 81, initiative: 0, empathy: 0, questionLink: 0 } }),
    ])!;
    expect(result.kindness!.avg).toBe(75.5);
  });

  // 채점되지 않은 지표가 있다고 나머지 지표까지 버릴 이유가 없다.
  it("null 점수는 그 지표에서만 제외한다", () => {
    const result = computeMetricAverages([
      sample({ scores: { kindness: 80, initiative: null, empathy: 60, questionLink: 60 } }),
      sample({ scores: { kindness: 60, initiative: 90, empathy: 60, questionLink: 60 } }),
    ])!;
    expect(result.kindness!.avg).toBe(70);
    expect(result.initiative!.avg).toBe(90); // null 1건은 평균에서 빠짐
  });

  it("모든 지표가 비어 있으면 null을 반환한다", () => {
    const empty = computeMetricAverages([
      sample({ scores: { kindness: null, initiative: null, empathy: null, questionLink: null } }),
    ]);
    expect(empty).toBeNull();
  });

  // 추세는 오래된 순 입력을 전제로 한다. 뒤집혀 들어오면 방향이 반대로 나온다.
  it("후반 평균이 높으면 up, 낮으면 down으로 본다", () => {
    const scores = (v: number) => ({ kindness: v, initiative: v, empathy: v, questionLink: v });
    const rising = computeMetricAverages(
      [40, 40, 80, 80].map((v) => sample({ scores: scores(v) }))
    )!;
    const falling = computeMetricAverages(
      [80, 80, 40, 40].map((v) => sample({ scores: scores(v) }))
    )!;
    expect(rising.kindness!.trend).toBe("up");
    expect(falling.kindness!.trend).toBe("down");
  });

  // 점수는 LLM 채점이라 몇 점 흔들리는 것은 추세가 아니다.
  it("차이가 임계값보다 작으면 flat으로 본다", () => {
    const scores = (v: number) => ({ kindness: v, initiative: v, empathy: v, questionLink: v });
    const result = computeMetricAverages(
      [70, 70, 72, 72].map((v) => sample({ scores: scores(v) }))
    )!;
    expect(result.kindness!.trend).toBe("flat");
  });

  // 표본이 적으면 절반으로 갈라도 각 구간이 1건이라 흔들림과 추세를 구분할 수 없다.
  it("표본이 4건 미만이면 추세를 판정하지 않는다", () => {
    const scores = (v: number) => ({ kindness: v, initiative: v, empathy: v, questionLink: v });
    const result = computeMetricAverages([20, 95].map((v) => sample({ scores: scores(v) })))!;
    expect(result.kindness!.trend).toBe("flat");
  });
});

describe("collectStruggleSituations", () => {
  const low = LOW_SCORE_THRESHOLD - 10;
  const high = LOW_SCORE_THRESHOLD + 10;
  const scores = (v: number) => ({ kindness: v, initiative: v, empathy: v, questionLink: v });

  it("지표가 낮게 나온 대화를 상황 조합별로 센다", () => {
    const result = collectStruggleSituations([
      sample({ scores: scores(low), environment: "school", partnerRole: "senior" }),
      sample({ scores: scores(low), environment: "school", partnerRole: "senior" }),
      sample({ scores: scores(low), environment: "online", partnerRole: "friend" }),
    ]);

    expect(result[0]).toMatchObject({
      environment: "school",
      partnerRole: "senior",
      lowScoreCount: 2,
    });
    expect(result[1].lowScoreCount).toBe(1); // 많이 막힌 조합이 앞에 온다
  });

  it("지표가 모두 임계값 이상이면 세지 않는다", () => {
    expect(collectStruggleSituations([sample({ scores: scores(high) })])).toEqual([]);
  });

  // 지표 수만큼 세면 "네 지표가 모두 낮은 대화 1건"이 "한 지표만 낮은 대화 4건"과 같아진다.
  it("한 대화에서 지표 여러 개가 낮아도 1로 센다", () => {
    const result = collectStruggleSituations([
      sample({ scores: { kindness: low, initiative: low, empathy: low, questionLink: low } }),
    ]);
    expect(result[0].lowScoreCount).toBe(1);
  });

  // 상황 축이 없는 대화를 남기면 서로 다른 상황이 하나로 뭉쳐 "이 조합에서 막힌다"가 깨진다.
  it("상황 축이 없는 대화는 제외한다", () => {
    const result = collectStruggleSituations([
      sample({ scores: scores(low), environment: null, partnerRole: null }),
    ]);
    expect(result).toEqual([]);
  });

  it("채점된 지표가 하나도 없으면 세지 않는다", () => {
    const result = collectStruggleSituations([
      sample({
        scores: { kindness: null, initiative: null, empathy: null, questionLink: null },
      }),
    ]);
    expect(result).toEqual([]);
  });
});

describe("collectRepeatedTexts", () => {
  it("여러 대화에 걸쳐 반복된 항목만 남긴다", () => {
    const result = collectRepeatedTexts(
      [["되묻기 부족"], ["되묻기 부족"], ["말끝 흐림"]],
      2
    );
    expect(result).toEqual(["되묻기 부족"]);
  });

  // 표현이 조금씩 달라 완전 일치로는 거의 안 겹친다.
  it("공백·문장부호 차이는 같은 항목으로 본다", () => {
    const result = collectRepeatedTexts([["되묻기 부족!"], ["되묻기부족"]], 2);
    expect(result).toHaveLength(1);
  });

  // 반복은 대화 사이에서 일어나야 의미가 있다. 한 대화 안의 중복은 반복이 아니다.
  it("같은 대화 안의 중복은 1회로 센다", () => {
    const result = collectRepeatedTexts([["되묻기 부족", "되묻기 부족"]], 2);
    expect(result).toEqual([]);
  });

  it("많이 반복된 항목이 앞에 온다", () => {
    const result = collectRepeatedTexts(
      [["A", "B"], ["A", "B"], ["A"]],
      2
    );
    expect(result).toEqual(["A", "B"]);
  });
});

// modules/growth/services/growth-profile.service.ts
//
// 성장 프로필의 갱신(쓰기)과 조회(읽기) 진입점.
//
//   피드백 ready → refreshGrowthProfile  →  User_Growth_Profiles 1행
//                                              ↓
//   GET /missions/today → getGrowthProfileForRecommendation → LLM 프롬프트 힌트
//
// 추천이 대화 원문을 직접 읽지 않는 이유 — GET /missions/today는 앱을 열면 바로 타는 경로라,
// 대화 수에 비례하는 토큰·지연을 감당할 수 없다. 그래서 피드백이 완성될 때 미리 요약해 둔다.

import { logger } from "../../../config/logger";
import {
  FeedbackSample,
  GrowthProfileView,
  MetricAverages,
  MIN_FEEDBACKS_FOR_PROFILE,
  StruggleSituation,
  SUMMARY_WINDOW,
} from "../dtos/growth-profile.dto";
import * as growthRepository from "../repositories/growth-profile.repository";
import {
  collectRepeatedTexts,
  collectStruggleSituations,
  computeMetricAverages,
  toFeedbackSample,
} from "./growth-aggregate.service";
import { buildSummaryPromptInput, generateGrowthSummary } from "./growth-summary.service";

// 강점·개선점으로 인정할 최소 반복 횟수. 1회성 지적을 성향으로 굳히지 않기 위해 2회 이상만 남긴다.
const REPEAT_MIN_COUNT = 2;

// 한 번의 갱신에서 커서를 전진시킬 최대 건수.
// 상한이 없으면 오래 쉬었던 사용자가 돌아왔을 때 한 요청에서 수백 건을 읽는다.
// 남은 건은 다음 피드백 때 이어서 따라잡는다(커서가 그만큼만 전진하므로 유실되지 않는다).
const CURSOR_BATCH_LIMIT = 50;

const toStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

// ── 갱신 (쓰기) ──────────────────────────────────────────────

// 피드백이 ready가 된 뒤 호출한다. 새로 반영할 피드백이 없으면 아무 것도 하지 않는다.
//
// 예외를 던지지 않는다 — 호출부(피드백 생성)는 사용자가 기다리는 응답이라,
// 요약 실패가 그쪽을 막으면 안 된다. 커서를 전진시키지 않았으므로 다음 피드백 때
// 같은 지점부터 다시 따라잡는다.
export const refreshGrowthProfile = async (userId: string): Promise<void> => {
  try {
    const profile = await growthRepository.findGrowthProfile(userId);

    // 커서가 없으면(첫 갱신) 조건을 걸지 않고 전체를 읽는다.
    // 두 값 중 하나라도 비어 있으면 커서로 쓸 수 없다 — 비교식이 NULL이 되어 한 건도 걸리지 않는다.
    const cursor =
      profile?.last_reflected_at && profile.last_feedback_id
        ? { readyAt: profile.last_reflected_at, feedbackId: profile.last_feedback_id }
        : null;

    const pending = await growthRepository.findReadyFeedbacksAfterCursor(
      userId,
      cursor,
      CURSOR_BATCH_LIMIT
    );
    if (pending.length === 0) return;

    // 커서는 "여기까지 봤다"는 표시라 이번에 읽은 마지막 행으로 전진시킨다.
    // 요약 자체는 아래에서 최근 창을 다시 읽어 만든다 — 요약은 누적이 아니라
    // "지금 시점의 최근 N건"을 다시 쓰는 것이라 증분분만으로는 만들 수 없다.
    const lastRead = pending[pending.length - 1];

    const windowRows = await growthRepository.findRecentReadyFeedbacks(userId, SUMMARY_WINDOW);
    // 레포지토리는 최신순으로 주지만, 추세는 시간 순서를 따라야 방향이 맞는다.
    const chronological = windowRows
      .map(toFeedbackSample)
      .filter((s): s is FeedbackSample => s !== null)
      .reverse();

    if (chronological.length === 0) return;

    const metricAverages = computeMetricAverages(chronological);
    const struggleSituations = collectStruggleSituations(chronological);
    const repeatedStrengths = collectRepeatedTexts(
      chronological.map((s) => s.strengths),
      REPEAT_MIN_COUNT
    );
    const repeatedImprovements = collectRepeatedTexts(
      chronological.map((s) => s.improvements),
      REPEAT_MIN_COUNT
    );

    const latest = chronological[chronological.length - 1];
    const summary = await generateGrowthSummary(
      buildSummaryPromptInput({
        samples: [...chronological].reverse(), // 프롬프트에는 최신순으로 보여준다
        metricAverages,
        struggleSituations,
        repeatedStrengths,
        repeatedImprovements,
        recentDifficulty: latest.difficulty,
      })
    );

    // LLM 실패 시 숫자 집계와 커서는 갱신하고, 서술 부분만 기존 값을 유지한다.
    // 여기서 통째로 중단하면 커서가 멈춰 다음 갱신이 같은 구간을 계속 다시 읽는다.
    await growthRepository.upsertGrowthProfile(userId, {
      summary: summary?.summary ?? profile?.summary ?? null,
      strengths: summary?.strengths ?? toStringArray(profile?.strengths),
      improvements: summary?.improvements ?? toStringArray(profile?.improvements),
      struggleSituations,
      metricAverages,
      suggestedDifficulty: summary?.suggestedDifficulty ?? profile?.suggested_difficulty ?? null,
      reflectedFeedbackCount: (profile?.reflected_feedback_count ?? 0) + pending.length,
      lastFeedbackId: lastRead.id,
      lastReflectedAt: lastRead.ready_at,
    });
  } catch (error) {
    logger.warn({ err: error, userId }, "성장 프로필 갱신 실패 (피드백 생성 자체는 정상 처리)");
  }
};

// ── 조회 (읽기) ──────────────────────────────────────────────

// 추천이 쓸 성장 프로필. 아래 경우에 null을 반환하고, 호출부는 프로필 없이 추천한다.
//  - 프로필 행이 없음 (아직 피드백이 없거나 갱신이 한 번도 안 돎)
//  - 반영된 피드백이 MIN_FEEDBACKS_FOR_PROFILE 미만 (표본 부족)
// 표본이 적을 때 신뢰하지 않는 이유는, 1건짜리 요약이 그날의 컨디션을 성향으로 굳히기 때문이다.
//
// 조회 실패는 삼킨다 — 성장 프로필은 추천을 거들 뿐이라 없으면 예전 경로로 추천하면 된다.
export const getGrowthProfileForRecommendation = async (
  userId: string
): Promise<GrowthProfileView | null> => {
  try {
    const profile = await growthRepository.findGrowthProfile(userId);
    if (!profile) return null;
    if (profile.reflected_feedback_count < MIN_FEEDBACKS_FOR_PROFILE) return null;

    return {
      summary: profile.summary,
      strengths: toStringArray(profile.strengths),
      improvements: toStringArray(profile.improvements),
      struggleSituations: Array.isArray(profile.struggle_situations)
        ? (profile.struggle_situations as unknown as StruggleSituation[])
        : [],
      metricAverages: (profile.metric_averages as unknown as MetricAverages | null) ?? null,
      suggestedDifficulty: profile.suggested_difficulty,
      reflectedFeedbackCount: profile.reflected_feedback_count,
    };
  } catch (error) {
    logger.warn({ err: error, userId }, "성장 프로필 조회 실패 — 프로필 없이 추천");
    return null;
  }
};

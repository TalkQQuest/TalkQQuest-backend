// shared/ai/similarity.ts
// 임베딩 유사도로 "미리 정의한 항목 중 지금 상황에 맞는 것"을 고르는 공통 처리.
//
// 표현 변형이 무한한 대상(예: "무슨 말을 해야 할지 모르겠어" / "딱히 생각이 안 나")을 매칭할 때 쓴다.
// 반대로 표현이 한정적인 대상(정체 질문 등)은 정규식이 더 싸고 정확하므로 여기까지 오지 않는다
// — conversations/services/conversation-guard.service.ts 참고.
//
// 벡터 저장은 DB(JSON 컬럼)가 단일 출처다. 벡터 스토어 라이브러리를 쓰지 않는 이유:
// 파일/외부 인덱스를 두면 DB와 이중 관리가 되고 서버 인스턴스가 여럿일 때 동기화 문제가 생긴다.
// 후보가 수십 개 규모라 선형 스캔으로 충분하다(ANN 인덱스 불필요).

import similarity from "compute-cosine-similarity";
import { logger } from "../../config/logger";
import { callUpstageEmbedding } from "./upstage.client";

/** 임베딩을 들고 있는 후보. 무엇을 담든 상관없도록 제네릭으로 둔다. */
export interface EmbeddedCandidate {
  embedding: number[];
}

export type ScoredCandidate<T> = T & { score: number };

export interface MatchOptions {
  /** 이 값 미만이면 "관련 없음"으로 보고 버린다. */
  threshold: number;
  /** 최대 몇 개까지 고를지. */
  limit: number;
  /** 로그에서 어느 기능인지 구분할 이름. */
  label: string;
}

/**
 * 질의 문장을 query 모델로 임베딩한다. 실패하면 null.
 *
 * 한 턴에 여러 대상을 매칭할 때는 이 함수로 **벡터를 한 번만 만들어 재사용**한다.
 * (대화 한 턴에서 상황 규칙 매칭과 흐름 단계 판정을 모두 하는데, 각자 임베딩하면
 *  같은 문장에 대해 API를 두 번 부르게 된다.)
 */
export const embedQuery = async (query: string, label: string): Promise<number[] | null> => {
  const embedded = await callUpstageEmbedding([query], "query");
  if (!embedded.ok) {
    logger.warn({ label, reason: embedded.reason }, "질의 임베딩 실패");
    return null;
  }
  return embedded.embeddings[0];
};

/** 코사인 유사도. 차원이 다르면 라이브러리가 null을 돌려주므로 0으로 본다. */
export const cosine = (a: number[], b: number[]): number => similarity(a, b) ?? 0;

/**
 * 이미 만들어 둔 질의 벡터로 후보를 추려 유사도 내림차순으로 돌려준다.
 *
 * 저장된 후보는 passage 모델로 임베딩해 둔 값이어야 한다(Upstage는 비대칭 검색).
 */
export const rankByVector = <T extends EmbeddedCandidate>(
  candidates: T[],
  queryVector: number[],
  options: Omit<MatchOptions, "label">
): ScoredCandidate<T>[] =>
  candidates
    .map((candidate) => ({ ...candidate, score: cosine(queryVector, candidate.embedding) }))
    .filter((candidate) => candidate.score >= options.threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, options.limit);

/**
 * 임베딩 + 매칭을 한 번에 하는 편의 함수. 한 턴에 한 대상만 매칭할 때 쓴다.
 * 여러 대상을 매칭한다면 embedQuery + rankByVector로 나눠 벡터를 재사용할 것.
 *
 * 임베딩 호출이 실패하면 빈 배열 — 매칭을 건너뛸 뿐 호출부의 기능 자체는 계속 동작해야 한다.
 */
export const matchByEmbedding = async <T extends EmbeddedCandidate>(
  candidates: T[],
  query: string,
  options: MatchOptions
): Promise<ScoredCandidate<T>[]> => {
  if (candidates.length === 0) return [];

  const queryVector = await embedQuery(query, options.label);
  if (!queryVector) return [];

  return rankByVector(candidates, queryVector, options);
};

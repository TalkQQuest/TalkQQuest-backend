// modules/mission/dtos/playbook.dto.ts
// 대화 플레이북 조회·수정 API의 요청/응답 형태.
//
// 임베딩(4096차원 × 10개, 1MB 이상)은 요청에도 응답에도 넣지 않는다.
// 응답에 넣으면 쓸모없이 거대해지고, 요청으로 받으면 텍스트와 어긋난 벡터가 들어올 수 있다.
// 수정 시 임베딩은 항상 서버가 텍스트로부터 다시 계산한다.

import { playbookInputSchema } from "../services/playbook.service";

export interface PlaybookFlowStepDto {
  /** 이 단계에서 상대역이 무엇을 하는지. @example "가볍게 근황을 물어 편한 분위기 만들기" */
  step: string;
  /**
   * 이 단계를 지났다고 볼 **사용자의 실제 발화** 2~4개.
   * 서술("사용자가 근황을 꺼냄")이 아니라 발화 그대로 써야 매칭이 동작한다.
   * @example ["요즘 시험 준비하느라 바빠", "그냥 회사 다니면서 지내"]
   */
  advanceExamples: string[];
}

export interface PlaybookResponseRuleDto {
  /** 사용자가 보일 만한 반응. @example "무슨 말을 해야 할지 모르겠다고 함" */
  when: string;
  /** 상대역이 반응할 방향(할 말 자체가 아니라 방향). @example "선택지를 좁혀 하나만 물어보기" */
  then: string;
}

export interface PlaybookViewDto {
  /** 대화가 거쳐갈 단계 3개. 서버가 진행도를 계산해 매 턴 한 단계만 프롬프트에 넣는다. */
  flow: PlaybookFlowStepDto[];
  /** 상황별 대응 지침. 사용자 발화와 의미가 가까운 것만 골라 주입한다. */
  responseRules: PlaybookResponseRuleDto[];
  /**
   * 임베딩이 붙어 있는지. 생성 시 임베딩 호출이 실패하면 false가 되고,
   * 그 경우 단계 진행이 유사도 없이 턴 상한으로만 동작한다.
   * @example true
   */
  hasEmbeddings: boolean;
}

export interface PlaybookResponseDto {
  missionId: string;
  playbook: PlaybookViewDto;
  /** @example "2026-08-03T10:00:00.000Z" */
  updatedAt: string;
}

// PUT 요청 본문. 검증 규칙(단계 3개, 예시 2~4개, 규칙 1~5개)은 생성 시와 동일한 스키마를 쓴다 —
// 사람이 손으로 넣은 값이 LLM 생성분보다 느슨하면 안 된다.
export interface PlaybookRequestDto {
  flow: PlaybookFlowStepDto[];
  responseRules: PlaybookResponseRuleDto[];
}

export const playbookRequestSchema = playbookInputSchema;

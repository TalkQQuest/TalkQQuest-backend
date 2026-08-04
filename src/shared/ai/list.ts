// shared/ai/list.ts
// LLM에게 "문장을 한 줄에 하나씩" 받아 목록으로 만드는 공통 처리.
//
// 미션 첫 마디(prep)·추천 답변이 각자 같은 코드를 갖고 있었다. 모델이 시키지 않아도 번호·불릿·
// 따옴표를 붙이는 일이 잦아, 파싱 단계에서 걷어내고 형식이 어긋난 줄은 버린다.

// 모델이 붙이는 머리기호를 제거한다: "- ", "* ", "• ", "1. ", "2) "
const LEADING_MARKER = /^\s*(?:[-*•]|\d+[.)])\s*/;
// 줄 전체를 감싼 따옴표.
const WRAPPING_QUOTES = /^["'“”]+|["'“”]+$/g;

export interface ParseListOptions {
  /** 최대 몇 개까지 가져올지. */
  limit: number;
  /** 각 줄이 쓸 만한 형식인지. 통과하지 못한 줄은 고치지 않고 버린다. */
  isValid?: (line: string) => boolean;
}

/**
 * 줄 단위 응답을 문자열 배열로 정리한다.
 * 머리기호·감싼 따옴표를 걷어내고, 빈 줄과 중복을 제거한 뒤 limit개까지 반환한다.
 *
 * 형식이 어긋난 줄은 **고치려 하지 않고 버린다.** 억지로 살리면 어색한 문장이 그대로
 * 사용자에게 노출되고, 캐시되는 값이면 계속 남는다.
 */
export const parseLineList = (raw: string, options: ParseListOptions): string[] => {
  const seen = new Set<string>();

  return raw
    .split("\n")
    .map((line) => line.replace(LEADING_MARKER, "").replace(WRAPPING_QUOTES, "").trim())
    .filter((line) => {
      if (line.length === 0) return false;
      if (options.isValid && !options.isValid(line)) return false;
      if (seen.has(line)) return false;
      seen.add(line);
      return true;
    })
    .slice(0, options.limit);
};

/** 목록에서 무작위로 count개를 고른다(Fisher-Yates). 원본은 건드리지 않는다. */
export const pickRandom = <T>(items: T[], count: number): T[] => {
  if (items.length <= count) return [...items];

  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, count);
};

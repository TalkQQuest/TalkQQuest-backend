// 한글 받침 유무에 따라 조사를 고르는 유틸. 자동 생성 문구(리포트 하이라이트 등)에서
// "친절한 태도이(가)" 같은 어색한 표기 대신 "친절한 태도가"처럼 자연스러운 조사를 붙일 때 쓴다.
const HANGUL_BASE = 0xac00;
const HANGUL_LAST = 0xd7a3;

// 완성형 한글 음절(가~힣)의 코드포인트는 (초성*21 + 중성)*28 + 종성 + 0xAC00 구조라
// (code - 0xAC00) % 28 === 0 이면 받침이 없다.
const hasBatchim = (word: string): boolean => {
  const lastChar = word.trim().at(-1);
  if (!lastChar) return false;
  const code = lastChar.charCodeAt(0);
  if (code < HANGUL_BASE || code > HANGUL_LAST) return false; // 한글 음절이 아니면 받침 없음으로 취급
  return (code - HANGUL_BASE) % 28 !== 0;
};

export const withSubjectParticle = (word: string): string => `${word}${hasBatchim(word) ? "이" : "가"}`;
export const withObjectParticle = (word: string): string => `${word}${hasBatchim(word) ? "을" : "를"}`;

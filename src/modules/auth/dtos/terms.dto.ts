// API 명세서 `이용약관 조회`, `개인정보처리방침 조회` 참고.
export interface TermsDto {
  type: "terms" | "privacy";
  version: string;
  content: string;
  createdAt: string;
}

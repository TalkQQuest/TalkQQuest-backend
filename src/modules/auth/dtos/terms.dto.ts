// design.md `### Auth APIs` > GET /terms/latest 참고.
export interface TermsDto {
  id: string;
  type: "terms" | "privacy";
  version: string;
  content: string;
}

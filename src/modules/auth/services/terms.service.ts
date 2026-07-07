import { findLatestActiveTerms } from "../repositories/auth.repository";
import { TermsNotFoundError } from "../errors/terms.error";
import { TermsDto } from "../dtos/terms.dto";

const NOT_FOUND_MESSAGE: Record<"terms" | "privacy", string> = {
  terms: "약관을 찾을 수 없습니다",
  privacy: "개인정보처리방침을 찾을 수 없습니다",
};

export const getLatestTerms = async (type: "terms" | "privacy"): Promise<TermsDto> => {
  const terms = await findLatestActiveTerms(type);
  if (!terms) {
    throw new TermsNotFoundError(NOT_FOUND_MESSAGE[type]);
  }
  return {
    type: terms.type,
    version: terms.version,
    content: terms.content,
    createdAt: terms.created_at.toISOString(),
  };
};

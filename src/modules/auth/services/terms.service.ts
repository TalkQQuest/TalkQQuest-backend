import { findLatestActiveTerms } from "../repositories/auth.repository";
import { TermsNotFoundError } from "../errors/terms.error";
import { TermsDto } from "../dtos/terms.dto";

export const getLatestTerms = async (type: "terms" | "privacy"): Promise<TermsDto> => {
  const terms = await findLatestActiveTerms(type);
  if (!terms) {
    throw new TermsNotFoundError();
  }
  return { id: terms.id, type: terms.type, version: terms.version, content: terms.content };
};

import { withObjectParticle, withSubjectParticle } from "../korean";

describe("withSubjectParticle", () => {
  it("받침 없는 단어에는 '가'를 붙인다", () => {
    expect(withSubjectParticle("대화 주도")).toBe("대화 주도가");
  });

  it("받침 있는 단어에는 '이'를 붙인다", () => {
    expect(withSubjectParticle("질문 연결성")).toBe("질문 연결성이");
    expect(withSubjectParticle("공감 능력")).toBe("공감 능력이");
  });

  it("한글이 아닌 문자열이면 '가'를 붙인다(안전한 기본값)", () => {
    expect(withSubjectParticle("XP")).toBe("XP가");
  });
});

describe("withObjectParticle", () => {
  it("받침 없는 단어에는 '를'을 붙인다", () => {
    expect(withObjectParticle("친절한 태도")).toBe("친절한 태도를");
  });

  it("받침 있는 단어에는 '을'을 붙인다", () => {
    expect(withObjectParticle("공감 능력")).toBe("공감 능력을");
  });
});

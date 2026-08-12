import { passwordSchema } from "../email-auth.dto";

// #181 — 화면(Figma)에는 특수문자 필수 조건이 없는데 서버 검증에만 남아있어, 영문+숫자만
// 입력해도 통과해야 할 비밀번호가 거부되던 버그. 특수문자 조건을 제거하고 8~16자 제한을 맞췄다.
describe("passwordSchema", () => {
  it("특수문자 없이 영문+숫자만으로도 통과한다", () => {
    expect(passwordSchema.safeParse("abcd1234").success).toBe(true);
  });

  it("특수문자가 섞여 있어도 여전히 통과한다(필수는 아니지만 허용은 함)", () => {
    expect(passwordSchema.safeParse("abcd1234!").success).toBe(true);
  });

  it("8자 미만이면 거부한다", () => {
    expect(passwordSchema.safeParse("ab12").success).toBe(false);
  });

  it("16자를 초과하면 거부한다", () => {
    expect(passwordSchema.safeParse("a".repeat(13) + "1234").success).toBe(false);
  });

  it("16자는 그대로 통과한다(경계값)", () => {
    expect(passwordSchema.safeParse("a".repeat(12) + "1234").success).toBe(true);
  });

  it("숫자가 없으면 거부한다", () => {
    expect(passwordSchema.safeParse("abcdefgh").success).toBe(false);
  });

  it("영문이 없으면 거부한다", () => {
    expect(passwordSchema.safeParse("12345678").success).toBe(false);
  });
});

// 모든 도메인 에러의 베이스 클래스입니다.
// 도메인별 에러는 modules/{domain}/errors/{domain}.error.ts 에서 이 클래스를 상속해 정의합니다.
export class AppError extends Error {
  constructor(
    public readonly errorCode: string,
    public readonly statusCode: number,
    message: string,
    public readonly data?: unknown
  ) {
    super(message);
    this.name = new.target.name;
  }
}

// Express Request 객체 확장 타입
declare namespace Express {
  export interface Request {
    requestId?: string;
    user?: {
      id: string;
      email: string | null;
    };
  }
}

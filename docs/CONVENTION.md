# TalkQuest 백엔드 협업 컨벤션

이 문서는 TalkQuest 백엔드(Node.js + Express + TypeScript) 프로젝트의 Git/브랜치 전략, 코드 컨벤션, PR 규칙을 정리한 문서입니다.
요구사항/ERD/API 명세는 [requirements.md](requirements.md), [design.md](design.md)를 참고하세요.

---

## 1. Git Convention

### 커밋 유형

| 이모지 | 타입 | 설명 |
|---|---|---|
| 🎉 | Init | 프로젝트 세팅 |
| ✨ | Feat | 새로운 기능 추가 |
| 🐛 | Fix | 버그 수정 |
| 💄 | Design | UI(CSS) 수정 |
| ✏️ | Typing Error | 오타 수정 |
| 📝 | Docs | 문서 수정 |
| 🚚 | Mod | 폴더 구조 이동 및 파일 이름 수정 |
| 💡 | Add | 파일 추가 (ex- 이미지 추가) |
| 🔥 | Del | 파일 삭제 |
| ♻️ | Refactor | 코드 리팩토링 |
| 🚧 | Chore | 배포, 빌드 등 기타 작업 |
| 🔀 | Merge | 브랜치 병합 |

**형식**: `커밋유형: 상세설명 (#이슈번호)`

**예시**
```
🎉 Init: 프로젝트 초기 세팅 (#1)
✨ Feat: 미션 추천 API 개발 (#2)
```

### Branch Convention (GitHub Flow)

**브랜치 종류**

| 종류 | 설명 |
|---|---|
| `init` | 프로젝트 세팅 |
| `feat` | 새로운 기능 추가 |
| `fix` | 버그 수정 |
| `refactor` | 코드 리팩토링 |

**형식**: `브랜치종류/#이슈번호/상세기능`

**예시**
```
init/#1/init
feat/#2/mission-recommendation
fix/#3/token-balance
```

---

## 2. 프로젝트 구조 — 도메인형 (Controller → Service → Repository)

```
src/
├── app.ts                  # Express 앱 초기화
├── server.ts               # 서버 진입점
├── config/                 # 환경 설정
│   ├── database.ts
│   ├── redis.ts
│   └── env.ts
├── middlewares/             # 공통 미들웨어
│   ├── auth.ts              # JWT 검증
│   ├── errorHandler.ts      # 전역 예외 처리
│   ├── requestId.ts         # X-Request-Id 부여
│   └── validator.ts         # Zod 기반 요청 검증
├── modules/                 # 도메인별 모듈
│   ├── auth/
│   │   ├── controllers/
│   │   │   └── auth.controller.ts   # tsoa @Route 데코레이터로 라우트 정의
│   │   ├── services/
│   │   │   └── auth.service.ts      # 비즈니스 로직, 트랜잭션
│   │   ├── repositories/
│   │   │   └── auth.repository.ts   # Prisma 접근은 이 계층에서만 수행
│   │   ├── dtos/
│   │   │   └── auth.dto.ts          # Request/Response 타입 + Zod 스키마
│   │   └── errors/
│   │       └── auth.error.ts        # 도메인 전용 에러 클래스
│   ├── onboarding/
│   ├── mission/
│   ├── coaching/
│   ├── community/
│   ├── payment/
│   ├── report/
│   └── notification/        # FCM 푸시 발송
├── shared/                  # 공통 유틸리티
│   ├── errors/
│   │   └── app-error.ts     # 모든 도메인 에러의 베이스 클래스
│   ├── utils/
│   │   └── response.ts      # 공통 응답 포맷 헬퍼 (sendSuccess 등)
│   └── constants/
├── generated/                # tsoa가 생성하는 routes.ts (자동 생성, 직접 수정 금지)
│   └── routes.ts
└── prisma/
    ├── schema.prisma
    └── migrations/
```

**레이어 원칙**
- **Controller**: 요청 파싱(`@Path`/`@Body`/`@Query`)과 응답 변환만 담당. 비즈니스 로직을 두지 않는다.
- **Service**: 비즈니스 로직, 검증, 트랜잭션(`prisma.$transaction`)을 담당.
- **Repository**: Prisma 호출은 이 계층에서만 한다. 서비스에서 `prisma.xxx.findMany()`를 직접 호출하지 않는다.
- **DTO**: 도메인별 폴더에 기능 단위로 Request/Response를 함께 정의한다 (하나의 기능에 관련 dto를 모아둔다).

---

## 3. Coding Convention

### 3.1 Code Styling

- **camelCase**: 변수명, 함수명 (`getReview`, `getMissionDetail`)
- **PascalCase**: 클래스, 타입, 인터페이스, Zod 스키마 변수명 (`MissionController`, `CreateMissionRequest`)
- **UPPER_SNAKE_CASE**: 상수 (`TOKEN_EXPIRY_SECONDS`)
- 파일명: `도메인명.역할.ts` (예: `mission.controller.ts`, `mission.service.ts`, `mission.repository.ts`, `mission.dto.ts`)

### 3.2 Routing & Swagger — tsoa

`*.routes.ts`를 수동 작성하지 않는다. 컨트롤러 클래스에 tsoa 데코레이터(`@Route`, `@Get`, `@Post` 등)를 붙이면, 빌드/개발 시 `tsoa spec-and-routes`가 `generated/routes.ts`와 `swagger.json`을 자동 생성한다. 스펙과 코드가 어긋날 일이 없다는 장점이 있다.

```ts
// modules/mission/controllers/mission.controller.ts
import { Controller, Post, Path, Body, Route, Tags, Middlewares } from 'tsoa';

@Route('missions')
@Tags('Mission')
export class MissionController extends Controller {
  /**
   * @summary 미션 결과 제출
   */
  @Post('{id}/complete')
  @Middlewares(authorizeUser(), validate(CompleteMissionRequestSchema))
  public async completeMission(
    @Path() id: string,
    @Body() body: CompleteMissionRequest
  ): Promise<ApiResponse<CompleteMissionResponseDto>> {
    const record = await missionService.completeMission(id, this.getUserId(), body);
    return success(record);
  }
}
```

> tsoa의 `@Body()`는 타입 추론만 해주고 런타임 검증은 하지 않으므로, `@Middlewares(validate(스키마))`로 Zod 검증을 함께 건다.

### 3.3 DTO — Zod 스키마 + 타입

```ts
// modules/mission/dtos/mission.dto.ts
import { z } from 'zod';

// 기능 + RequestSchema
export const CompleteMissionRequestSchema = z.object({
  result: z.enum(['success', 'failure', 'avoidance']),
  memo: z.string().optional(),
  durationMinutes: z.number().int().positive().optional(),
  emotion: z.string().optional(),
});
export type CompleteMissionRequest = z.infer<typeof CompleteMissionRequestSchema>;

// 기능 + ResponseDto
export interface CompleteMissionResponseDto {
  id: string;
  result: 'success' | 'failure' | 'avoidance';
  tokensEarned: number;
  experienceEarned: number;
  badgesEarned: string[];
  streakCount: number;
}
```

- 도메인(엔티티)별로 폴더(`modules/{domain}/dtos/`)를 만들고, 기능별로 Request/Response 스키마를 분리한다.
- 하나의 기능에 관련된 Request/Response는 같은 `*.dto.ts` 파일에 모아둔다.

### 3.4 Validation — Zod + `validator.ts` 미들웨어

```ts
// middlewares/validator.ts
export const validate = (schema: z.ZodSchema) =>
  (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      throw new ValidationError(result.error.issues);
    }
    req.body = result.data;
    next();
  };
```

검증은 컨트롤러 진입 전 미들웨어 단계에서 끝내고, 서비스 로직 안에서는 형식 검증을 다시 하지 않는다 (서비스는 비즈니스 규칙 검증만 담당).

### 3.5 Repository — Prisma 접근 전담

```ts
// modules/mission/repositories/mission.repository.ts
export const findMissionById = (id: string) =>
  prisma.mission.findUnique({ where: { id } });

export const createMissionRecord = (data: Prisma.MissionRecordCreateInput) =>
  prisma.missionRecord.create({ data });
```

### 3.6 Service

```ts
// modules/mission/services/mission.service.ts
export const completeMission = async (
  missionId: string,
  userId: string,
  req: CompleteMissionRequest
): Promise<CompleteMissionResponseDto> => {
  const mission = await missionRepository.findMissionById(missionId);
  if (!mission) throw new MissionNotFoundError();

  return prisma.$transaction(async (tx) => {
    const record = await missionRepository.createMissionRecord({ /* ... */ });
    // 토큰/경험치 적립, 배지 체크 등 비즈니스 로직
    return toResponseDto(record);
  });
};
```

- Java의 `Service 인터페이스 + ServiceImpl` 분리는 사용하지 않는다. 함수 단위로 export하고, 테스트 시 `jest.mock()`으로 대체한다.
- Controller는 비즈니스 로직 없이 Service 호출 결과만 응답으로 변환한다.

### 3.7 공통 응답 포맷

```ts
// shared/utils/response.ts
export interface ApiResponse<T> {
  success: boolean;
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
}

export const success = <T>(data: T): ApiResponse<T> => ({
  success: true,
  data,
  error: null,
});
```

응답 형식은 항상 `{ success, data, error }`로 고정한다 (design.md와 동일).

### 3.8 Exception / Error Code

도메인 접두사 + 일련번호로 코드를 부여한다.

| 접두사 | 도메인 |
|---|---|
| `E` | 공통(Common) |
| `A` | Auth |
| `O` | Onboarding |
| `M` | Mission |
| `C` | Coaching |
| `CM` | Community |
| `T` | Token |
| `P` | Payment |
| `R` | Report |
| `AI` | AI_Engine 연동 |

대표 코드 (design.md `## Error Codes`와 동일하게 유지):

| Code | Name | HTTP Status | Description |
|---|---|---|---|
| E4001 | VALIDATION_ERROR | 400 | 요청 데이터 유효성 검증 실패 |
| A4011 | UNAUTHORIZED | 401 | Access Token 누락/만료/무효 |
| A4031 | FORBIDDEN | 403 | 권한 없음 |
| E4041 | NOT_FOUND | 404 | 리소스를 찾을 수 없음 |
| T4021 | INSUFFICIENT_TOKENS | 402 | 토큰 잔여량 부족 |
| CM4091 | COMMUNITY_FULL | 409 | 모임 정원 초과 (대기 등록) |
| P4022 | PAYMENT_FAILED | 402 | 결제 처리 실패 |
| AI5031 | AI_SERVICE_UNAVAILABLE | 503 | AI_Engine 응답 실패 |
| E5001 | INTERNAL_SERVER_ERROR | 500 | 서버 내부 오류 |

같은 도메인에서 에러가 늘어나면 접두사를 유지한 채 번호만 이어 붙인다 (`M4041`, `M4042`...).

```ts
// shared/errors/app-error.ts
export class AppError extends Error {
  constructor(
    public errorCode: string,
    public statusCode: number,
    message: string,
    public data?: unknown
  ) {
    super(message);
  }
}
```

```ts
// modules/mission/errors/mission.error.ts (Entity + Exception 형식)
export class MissionNotFoundError extends AppError {
  constructor(data?: unknown) {
    super('M4041', 404, '존재하지 않는 미션입니다.', data);
  }
}
```

```ts
// middlewares/errorHandler.ts (전역 예외 처리)
export const errorHandler = (err: unknown, req: Request, res: Response, next: NextFunction) => {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      data: null,
      error: { code: err.errorCode, message: err.message, details: err.data },
    });
  }
  logger.error(err);
  return res.status(500).json({
    success: false,
    data: null,
    error: { code: 'E5001', message: '서버 내부 오류입니다.' },
  });
};
```

### 3.9 인증 (JWT)

- Kakao/Naver SDK가 발급한 **Provider Access Token**을 그대로 받아 각 Provider의 사용자 정보 조회 API로 검증한다 (Authorization Code 교환 로직은 구현하지 않음).
- 인증 성공 시 자체 **Access Token(JWT) + Refresh Token**을 발급한다.
- `middlewares/auth.ts`에서 JWT를 직접 검증한다 (passport 등 외부 인증 프레임워크 사용하지 않음).
- 상세 흐름/스키마는 [design.md](design.md)의 Auth APIs, Non-Functional Considerations 참고.

### 3.10 데이터베이스 메모 (적용 시점에 참고)

- ORM: Prisma, Database: MySQL 8.0.
- PK는 `CHAR(36)`에 UUID 문자열 저장, `JSONB` 대신 MySQL 네이티브 `JSON` 타입 사용 (자세한 내용은 [design.md](design.md) `### Database` 참고).
- Prisma 드라이버 어댑터를 쓸 경우 `@prisma/adapter-mysql`을 사용한다 (예전 실습 코드의 `@prisma/adapter-mariadb`를 그대로 가져오지 않도록 주의).

### 3.11 로깅 — Pino

- `console.log` / `console.error`를 직접 호출하지 않는다. 항상 `src/config/logger.ts`의 `logger`를 사용한다.
  - 예외: `src/config/env.ts`는 환경 변수 검증 실패 시점에 호출되는데, `logger`가 검증된 `env`에 의존하므로 그 시점에는 아직 만들 수 없다. 이 한 곳만 `console.error`를 그대로 둔다.
- HTTP 요청/응답 로그는 `pino-http`가 자동으로 남긴다 (`app.ts`). `requestId` 미들웨어가 만든 `X-Request-Id`를 그대로 pino의 `req.id`로 연결해두었으므로, 같은 요청의 로그는 모두 동일한 id로 묶인다.
- 로그 레벨: `development`는 `debug`, `production`은 `info`를 기본으로 사용한다 (`logger.ts`에서 `env.NODE_ENV` 기준으로 분기).
- 로그를 남길 때는 메시지 문자열만 던지지 않고, 두 번째 인자(또는 첫 번째 객체 인자)에 컨텍스트를 같이 담는다.
  ```ts
  logger.error({ requestId: req.requestId, err }, "결제 처리 실패");
  logger.info({ userId, missionId }, "미션 완료 처리");
  ```
- 비밀번호, 토큰(JWT/Provider Access Token/FCM 토큰), 결제 카드 정보 등 민감 정보는 로그 객체에 그대로 넣지 않는다.
- 개발 환경에서는 `pino-pretty`로 사람이 읽기 좋은 컬러 출력을, `production`/`test`에서는 별도 transport 없이 JSON 한 줄(structured log)로 출력한다. JSON 로그는 추후 파일/외부 로그 수집기(CloudWatch, Datadog 등)로 보내기 쉬운 형태를 유지하기 위함이며, 실제 영속화(파일 저장, 외부 전송) 방식은 배포 환경이 정해질 때 별도로 결정한다.

---

## 4. PR 규칙

1. Issue를 등록한다.
2. Git 컨벤션에 맞게 Branch를 생성한다 (`브랜치종류/#이슈번호/상세기능`).
3. Add → Commit → Push → Pull Request 과정을 거친다.
4. GitHub에서 PR을 생성하고, 해당 PR에 대한 리뷰를 요청한다.
5. 리뷰에서 Approve를 받지 못했다면, 수정 사항을 처리해서 다시 올린다.
6. Approve를 받았다면 Merge를 진행한다.
7. Merge된 Branch는 삭제한다.
8. 종료된 Issue와 Pull Request의 Label과 Project를 관리한다.

---

## 5. 관련 문서

- [requirements.md](requirements.md) — 기능 요구사항 (User Story / Acceptance Criteria)
- [design.md](design.md) — 아키텍처, ERD, API 명세, 에러 코드 전체 목록

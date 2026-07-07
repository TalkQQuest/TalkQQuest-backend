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

### Branch Convention

**브랜치 구조**: `main` / `dev` / 작업 브랜치(`init`, `feat`, `fix`, `refactor`, `docs`, `chore` ...) 3단 구조를 사용한다.

- `main`: 배포 가능한 상태만 유지. 평소에는 직접 push/merge하지 않는다.
- `dev`: 통합 브랜치. 모든 작업 브랜치는 `dev`에서 분기하고 `dev`로 PR을 보낸다.
- 작업 브랜치: `dev`에서 분기해서 작업하고, 끝나면 `dev`로 PR → 병합 후 삭제한다.
- `dev → main`은 릴리즈(배포) 시점에 별도로 병합한다 (평소 작업 흐름에는 포함되지 않음).

```
main ── dev ── feat/#12/mission-recommendation
            └─ fix/#13/token-balance
            └─ docs/#5-6/branch-and-doc-sync
```

> 예외: 프로젝트 극초기(레포에 커밋이 거의 없던 시점)에 만들어진 `init/#1/init`, `feat/#3/db-init`은 `dev`가 생기기 전이라 `main`에 직접 병합했다. 이 두 건 이후로는 전부 `dev`를 거친다.

**브랜치 종류**

| 종류 | 설명 |
|---|---|
| `init` | 프로젝트 세팅 |
| `feat` | 새로운 기능 추가 |
| `fix` | 버그 수정 |
| `refactor` | 코드 리팩토링 |
| `docs` | 문서 추가/수정 |
| `chore` | 빌드, 설정, 브랜치 전략 등 기타 작업 |

**형식**: `브랜치종류/#이슈번호/상세기능` (이슈가 여러 개에 걸친 작업이면 `#5-6`처럼 번호를 이어 쓴다)

**예시**
```
init/#1/init
feat/#2/mission-recommendation
fix/#3/token-balance
docs/#5-6/branch-and-doc-sync
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
  message: string;
  data: T | null;
  errorCode: string | null;
}

export const success = <T>(data: T, message = 'OK'): ApiResponse<T> => ({
  success: true,
  message,
  data,
  errorCode: null,
});

export const failure = (errorCode: string, message: string): ApiResponse<null> => ({
  success: false,
  message,
  data: null,
  errorCode,
});
```

응답 형식은 항상 `{ success, message, data, errorCode }`로 고정한다 (design.md와 동일).
- 성공 시: `success: true`, `data`에 실제 값, `errorCode: null`
- 실패 시: `success: false`, `data: null`, `errorCode`에 3.8의 문자열 코드
- `message`는 클라이언트가 그대로 보여줄 수 있는 짧은 한글 설명 문자열이다.
- 기능명세서 PDF 원안은 `{ success, message, data }`까지만 제시했지만, 클라이언트가 에러 종류를 분기 처리할 수 있도록 팀 논의를 거쳐 `errorCode` 필드를 추가했다.
- **TODO**: 검증 실패 시 필드별 상세 정보(어떤 필드가 왜 틀렸는지)를 새 포맷 어디에 실을지는 아직 정해지지 않았다. 우선은 `message` 문자열 하나로 표현하고, 구조화된 필드 단위 에러가 실제로 필요해지면 그때 다시 논의한다.

### 3.8 Exception / Error Code

**공통 에러 코드**

기능명세서 PDF가 명시한 공통 코드는 `VALIDATION_ERROR`, `UNAUTHORIZED`, `NOT_FOUND`, `DUPLICATED`, `SERVER_ERROR` 5개다. `FORBIDDEN`은 PDF에 없음 — 403이 필요한 케이스가 생기면 그때 확정한다. `EXPIRED`는 API 명세서에서 인증번호/토큰 만료를 나타내는 공통 코드로 등장해 함께 추가했다.

| Code | HTTP Status | Description |
|---|---|---|
| `VALIDATION_ERROR` | 400 | 요청 데이터 유효성 검증 실패 |
| `UNAUTHORIZED` | 401 | Access Token 누락/만료/무효 |
| `FORBIDDEN` | 403 | 권한 없음 (PDF에는 없음) |
| `NOT_FOUND` | 404 | 리소스를 찾을 수 없음 |
| `DUPLICATED` | 409 | 리소스 중복 (일반) |
| `EXPIRED` | 410 | 인증번호/토큰 등 시간 제한이 있는 리소스의 만료 |
| `SERVER_ERROR` | 500 | 서버 내부 오류 |

**도메인별 세부 코드**는 위 공통 코드로 표현이 안 될 때만, 의미가 분명한 이름으로 추가한다 (예: 인증 도메인의 `UNVERIFIED_EMAIL`, `INVALID_PASSWORD`). 접두사 규칙은 없으며, 코드 이름 자체가 곧 문서다. 도메인별 세부 코드 전체 목록은 [design.md](design.md) `## Error Codes` 참고.

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
    super('NOT_FOUND', 404, '존재하지 않는 미션입니다.', data);
  }
}
```

```ts
// middlewares/errorHandler.ts (전역 예외 처리)
export const errorHandler = (err: unknown, req: Request, res: Response, next: NextFunction) => {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json(failure(err.errorCode, err.message));
  }
  logger.error(err);
  return res.status(500).json(failure('SERVER_ERROR', '서버 내부 오류입니다.'));
};
```

### 3.9 인증 (JWT)

TalkQuest는 카카오/네이버 소셜 로그인과 이메일/비밀번호 로그인을 함께 지원한다.

**소셜 로그인 (카카오/네이버)**
- Kakao/Naver SDK가 발급한 **Provider Access Token**을 그대로 받아 각 Provider의 사용자 정보 조회 API로 검증한다 (Authorization Code 교환 로직은 구현하지 않음). 기능명세서 반영 이후에도 이 방식을 유지하기로 재확인했다.

**이메일/비밀번호 로그인**
- 회원가입 시 이메일 인증(인증번호 발송/확인)을 먼저 거친 뒤 비밀번호를 설정한다.
- 비밀번호 규칙: 8자 이상, 숫자·영문·특수문자 각각 1개 이상 포함. `bcrypt`로 해시하여 `Auth_Identities.password_hash`에 저장한다 (평문 저장 금지).
- 회원가입 시 이름, 생년월일, 학교/직업을 함께 수집해 `Users`에 저장한다.

**공통**
- 인증 성공 시 (소셜/이메일 무관) 자체 **Access Token(JWT) + Refresh Token**을 발급한다.
- `middlewares/auth.ts`에서 JWT를 직접 검증한다 (passport 등 외부 인증 프레임워크 사용하지 않음).
- 이미 가입된 이메일로 다른 로그인 수단(예: 카카오)을 시도하면, 계정을 새로 만들지 않고 **계정 연동 안내**를 응답에 포함한다.
- 상세 흐름/스키마는 [design.md](design.md)의 Auth APIs, ERD, Non-Functional Considerations 참고.

### 3.10 데이터베이스 메모 (적용 시점에 참고)

- ORM: Prisma, Database: MySQL 8.0.
- PK는 `CHAR(36)`에 UUID 문자열 저장, `JSONB` 대신 MySQL 네이티브 `JSON` 타입 사용.
- Prisma 드라이버 어댑터를 쓸 경우 `@prisma/adapter-mysql`을 사용한다 (예전 실습 코드의 `@prisma/adapter-mariadb`를 그대로 가져오지 않도록 주의).
- **ERD의 source of truth는 `prisma/schema.prisma`다.** design.md의 ERD 섹션은 전체 컬럼을 중복 기재하지 않고 도메인별 요약만 담는다 — 컬럼/제약조건/관계의 정확한 내용은 항상 `prisma/schema.prisma`를 직접 확인한다.

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

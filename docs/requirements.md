# Requirements Document

## Introduction

TalkQuest는 AI 기반 현실 대화 미션을 통해 청년의 오프라인 관계 형성을 돕는 미션형 소셜 트레이닝 앱입니다. 본 문서는 TalkQuest의 Node.js 백엔드 시스템에 대한 요구사항을 정의합니다.

핵심 흐름: 온보딩 → 미션 추천 → 현실 수행 → 기록 → 성장 확인

## Glossary

- **Backend_Server**: Node.js 기반 TalkQuest 백엔드 API 서버
- **Auth_Service**: 사용자 인증 및 세션 관리를 담당하는 서비스 모듈
- **OAuth_Provider**: 카카오, 네이버 등 소셜 로그인을 제공하는 외부 인증 서비스
- **Onboarding_Service**: 사용자 성향 분석 및 프로필 생성을 담당하는 서비스 모듈
- **Mission_Service**: 미션 추천, 수행, 결과 기록을 담당하는 서비스 모듈
- **AI_Engine**: 미션 추천 및 대화 코칭에 사용되는 AI 처리 모듈
- **Coaching_Service**: AI 기반 대화 코칭을 담당하는 서비스 모듈
- **Community_Service**: 모임 추천 및 채팅 기능을 담당하는 서비스 모듈
- **Token_System**: 서비스 이용 시 차감되는 내부 재화(토큰) 관리 시스템
- **Payment_Service**: 요금제 결제 및 토큰 충전을 담당하는 서비스 모듈
- **Report_Service**: 성장 리포트 및 통계 데이터를 생성하는 서비스 모듈
- **User**: TalkQuest 앱을 사용하는 최종 사용자
- **Access_Token**: 인증된 사용자 세션을 유지하기 위한 JWT 기반 토큰
- **Refresh_Token**: Access_Token 만료 시 재발급을 위한 장기 유효 토큰

## Requirements

### Requirement 1: 소셜 로그인 및 이메일 로그인 인증

**User Story:** As a User, I want to 카카오·네이버 계정 또는 이메일로 로그인할 수 있기를, so that 원하는 방식으로 빠르게 서비스를 이용할 수 있다.

#### Acceptance Criteria

1. WHEN User가 Android 카카오 SDK로 발급받은 Provider Access Token을 전송하면, THE Auth_Service SHALL 해당 토큰으로 OAuth_Provider의 사용자 정보 조회 API를 호출하여 인증을 수행한다.
2. WHEN User가 Android 네이버 SDK로 발급받은 Provider Access Token을 전송하면, THE Auth_Service SHALL 해당 토큰으로 OAuth_Provider의 사용자 정보 조회 API를 호출하여 인증을 수행한다.
3. WHEN User가 이메일로 회원가입을 요청하면, THE Auth_Service SHALL 이메일 인증(인증번호 발송/확인)을 먼저 완료시키고, 이름·생년월일·학교또는직업·비밀번호·약관 동의를 입력받아 계정을 생성한다.
4. THE Auth_Service SHALL 이메일 회원가입의 비밀번호가 8자 이상이며 숫자·영문·특수문자를 각각 1개 이상 포함하는지 검증하고, bcrypt로 해시하여 저장한다.
5. WHEN User가 이메일과 비밀번호로 로그인을 요청하면, THE Auth_Service SHALL 저장된 해시와 비교하여 인증을 수행한다.
6. WHEN 인증(소셜 또는 이메일)된 사용자가 기존 계정에 존재하지 않으면, THE Auth_Service SHALL 새로운 계정과 해당 로그인 수단(Auth_Identity)을 생성한다.
7. WHEN 인증된 사용자의 이메일이 다른 로그인 수단으로 이미 가입된 계정과 일치하면, THE Auth_Service SHALL 새 계정을 만들지 않고 계정 연동 안내 정보를 응답에 포함한다.
8. WHEN 인증이 성공하면, THE Auth_Service SHALL Access_Token과 Refresh_Token을 발급하고 로그인 이력, 접속 시간, 기기 정보를 기록한다.
9. WHEN Access_Token이 만료되면, THE Auth_Service SHALL 유효한 Refresh_Token을 검증하고 새로운 Access_Token을 발급한다.
10. IF Refresh_Token이 만료되었거나 유효하지 않으면, THEN THE Auth_Service SHALL 401 Unauthorized 응답을 반환하고 재로그인을 요구한다.

### Requirement 2: 온보딩 성향 분석

**User Story:** As a User, I want to 단계별 성향 분석을 완료할 수 있기를, so that 나에게 맞는 미션을 추천받을 수 있다.

#### Acceptance Criteria

1. THE Backend_Server SHALL 온보딩 데이터 구조를 다음 항목으로 정의한다: 성격 유형(내향/외향/중간), 대화 부담 정도, 어려운 상황 선택, 사용 목적 및 목표, 선호 관계 형성 방식, 관심 주제.
2. WHEN User가 온보딩 단계별 응답을 제출하면, THE Onboarding_Service SHALL 해당 단계의 응답을 임시 저장한다.
3. WHEN User가 이전 단계로 이동을 요청하면, THE Onboarding_Service SHALL 현재 단계까지의 응답을 유지한 채 이전 단계 데이터를 반환한다.
4. WHEN User가 온보딩 도중 이탈하면, THE Onboarding_Service SHALL 현재까지의 응답을 임시 저장하고 재진입 시 마지막 단계부터 이어서 진행할 수 있도록 한다.
5. WHEN User가 온보딩 전체 단계를 완료하면, THE Onboarding_Service SHALL 사용자 프로필을 생성하고 AI_Engine의 추천 모델 초기 세팅을 수행한다.

### Requirement 3: AI 미션 추천

**User Story:** As a User, I want to 나의 성향과 수준에 맞는 미션을 추천받기를, so that 부담 없이 단계적으로 대화 능력을 향상할 수 있다.

#### Acceptance Criteria

1. WHEN User가 미션 추천을 요청하면, THE Mission_Service SHALL 사용자 성향, 온보딩 결과, 수행 기록을 기반으로 AI_Engine에 미션 추천을 요청한다.
2. THE Mission_Service SHALL 추천 미션 응답에 난이도, 설명, 소요 시간, 추천 이유, 기대 효과를 포함한다.
3. WHILE 사용자의 수행 기록이 충분하지 않은 상태에서, THE Mission_Service SHALL 기본 미션 템플릿을 우선 제공한다.
4. WHEN 사용자가 특정 유형의 미션을 반복 회피한 이력이 존재하면, THE Mission_Service SHALL 해당 유형의 추천 빈도를 낮추고 대체 유형 미션을 제안한다.
5. IF AI_Engine의 추천 요청이 실패하면, THEN THE Mission_Service SHALL 기본 미션 템플릿 목록을 대체 응답으로 반환한다.

### Requirement 4: 미션 수행 및 결과 기록

**User Story:** As a User, I want to 미션 수행 결과를 기록할 수 있기를, so that 나의 성장 과정을 추적하고 다음 미션 추천에 반영할 수 있다.

#### Acceptance Criteria

1. WHEN User가 특정 미션의 상세 정보를 요청하면, THE Mission_Service SHALL 미션 설명, 준비 팁, 주의사항을 포함한 상세 정보를 반환한다.
2. WHEN User가 미션 수행 결과를 제출하면, THE Mission_Service SHALL 결과(성공/실패/회피), 메모, 수행 시간, 감정 상태를 저장한다.
3. WHEN 미션 수행 결과가 저장되면, THE Mission_Service SHALL 결과에 따라 다음 추천 미션 목록을 갱신한다.
4. WHEN 미션이 성공적으로 완료되면, THE Mission_Service SHALL 난이도, 연속 성공 횟수, 챌린지 참여 여부에 따라 차등 리워드(토큰, 배지, 경험치)를 지급한다.
5. WHEN User가 미션 수행 도중 이탈하면, THE Mission_Service SHALL 현재까지의 입력을 임시 저장하고 재진입 시 복원한다.
6. WHEN User가 동일 난이도 미션에서 3회 연속 실패하면, THE Mission_Service SHALL 해당 사용자의 추천 난이도를 한 단계 하향 조정한다.

### Requirement 5: AI 대화 코칭

**User Story:** As a User, I want to AI에게 대화 상황에 대한 코칭을 받을 수 있기를, so that 실제 대화에서 자연스럽게 소통할 수 있다.

#### Acceptance Criteria

1. WHEN User가 코칭 메시지를 전송하면, THE Coaching_Service SHALL 사용자 입력을 분석하고 상황 기반 답변을 생성한다.
2. THE Coaching_Service SHALL 코칭 응답에 자연스러운 표현 예시, 응답 대안, 후속 질문 예시를 포함한다.
3. WHILE 코칭 세션이 활성화된 상태에서, THE Coaching_Service SHALL 이전 대화 맥락을 유지하여 이어서 대화할 수 있도록 한다.
4. WHEN User의 설정된 말투/난이도 정보가 존재하면, THE Coaching_Service SHALL 해당 설정에 맞춰 코칭 톤을 조정한다.
5. IF AI_Engine의 응답 생성이 실패하면, THEN THE Coaching_Service SHALL 1회 재시도를 수행하고, 재시도 실패 시 미리 준비된 템플릿 답변을 반환한다.
6. WHEN 코칭 요청이 수신되면, THE Coaching_Service SHALL Token_System을 통해 토큰 잔여량을 확인하고 차감한다.

### Requirement 6: 커뮤니티 모임

**User Story:** As a User, I want to 나의 성향에 맞는 모임에 참여할 수 있기를, so that 비슷한 관심사를 가진 사람들과 교류할 수 있다.

#### Acceptance Criteria

1. WHEN User가 모임 목록을 요청하면, THE Community_Service SHALL 사용자 성향 및 관심사 기반으로 모임을 추천하고 목록을 반환한다.
2. THE Community_Service SHALL 모임 응답에 소개, 참여 조건, 활동 빈도, 현재 참여 인원을 포함한다.
3. WHEN User가 모임 참여를 요청하면, THE Community_Service SHALL 정원 확인 후 참여를 승인하고 채팅방 접근 권한을 부여한다.
4. IF 모임 정원이 초과된 상태이면, THEN THE Community_Service SHALL 대기 등록을 수행하고 자리 발생 시 알림을 발송하며 대체 모임을 추천한다.
5. WHEN User가 채팅 메시지를 전송하면, THE Community_Service SHALL 해당 모임의 채팅방에 메시지를 실시간으로 전달한다.

### Requirement 7: 토큰 및 결제 관리

**User Story:** As a User, I want to 토큰 잔여량을 확인하고 필요 시 충전할 수 있기를, so that 서비스를 중단 없이 이용할 수 있다.

#### Acceptance Criteria

1. WHEN User가 토큰 정보를 조회하면, THE Token_System SHALL 잔여 토큰 수량과 누적 사용량을 반환한다.
2. WHEN 토큰 잔여량이 임계치 이하로 감소하면, THE Token_System SHALL 경고 정보를 응답에 포함한다.
3. WHEN 무료 한도가 초과되면, THE Token_System SHALL 유료 요금제 안내 정보를 반환한다.
4. WHEN User가 요금제 목록을 요청하면, THE Payment_Service SHALL 베이직/프리미엄 요금제 비교 정보를 반환한다.
5. WHEN User가 결제를 완료하면, THE Payment_Service SHALL 추가 토큰 지급, 고급 AI 코칭 접근 권한 활성화, 특별 리워드 배율 혜택을 적용한다.
6. IF 결제 처리가 실패하면, THEN THE Payment_Service SHALL 1회 재시도를 수행하고, 실패 시 다른 결제 수단 안내를 반환한다.
7. THE Payment_Service SHALL Android 앱 내 디지털 재화(토큰/구독) 결제 시 Google Play 결제 정책(인앱결제 의무화 대상 여부)을 검토하여 PG사 직결제와 Google Play Billing 중 적용 방식을 결정한다.

### Requirement 8: 성장 리포트

**User Story:** As a User, I want to 나의 성장 과정을 리포트로 확인할 수 있기를, so that 동기를 부여받고 변화를 체감할 수 있다.

#### Acceptance Criteria

1. WHEN User가 성장 리포트를 요청하면, THE Report_Service SHALL 누적 미션 수, 성공률, 난이도 변화, 자주 시도한 상황 유형 데이터를 반환한다.
2. WHEN User가 주간 리포트를 요청하면, THE Report_Service SHALL 해당 주의 미션 수행률과 성과 요약을 반환한다.
3. THE Report_Service SHALL 리포트 데이터를 프론트엔드에서 시각화할 수 있는 구조화된 JSON 형식으로 반환한다.

### Requirement 9: 사용자 프로필 및 활동 이력

**User Story:** As a User, I want to 나의 프로필과 활동 이력을 관리할 수 있기를, so that 개인 정보와 설정을 편리하게 조정할 수 있다.

#### Acceptance Criteria

1. WHEN User가 프로필 정보를 요청하면, THE Backend_Server SHALL 사용자의 성향 정보, 레벨, 배지, 누적 경험치를 반환한다.
2. WHEN User가 미션 수행 기록 목록을 요청하면, THE Backend_Server SHALL 페이지네이션을 적용하여 수행 기록을 반환한다.
3. WHEN User가 알림 설정을 변경하면, THE Backend_Server SHALL 변경된 알림 설정을 저장하고 확인 응답을 반환한다.
4. WHEN User가 로그아웃을 요청하면, THE Auth_Service SHALL 현재 세션의 Refresh_Token을 무효화하고 성공 응답을 반환한다.
5. WHEN User가 계정 삭제를 요청하면, THE Auth_Service SHALL 사용자 데이터를 비활성화 처리하고 30일 유예 기간 후 삭제 예약을 수행한다.

### Requirement 10: 공통 API 규칙

**User Story:** As a 개발자, I want to 일관된 API 구조와 에러 처리를 갖추기를, so that 프론트엔드와의 통합이 원활하고 유지보수가 용이하다.

#### Acceptance Criteria

1. THE Backend_Server SHALL 모든 API 응답을 `{ success: boolean, message: string, data: object | null, errorCode: string | null }` 형식으로 반환한다.
2. THE Backend_Server SHALL RESTful URL 규칙을 따르고 API 버전을 경로에 포함한다 (예: `/api/v1/...`).
3. WHEN 인증이 필요한 API에 유효하지 않은 Access_Token이 전달되면, THE Backend_Server SHALL 401 상태 코드와 에러 메시지를 반환한다.
4. WHEN 요청 데이터의 유효성 검증이 실패하면, THE Backend_Server SHALL 400 상태 코드와 실패한 필드 정보를 포함한 에러 응답을 반환한다.
5. WHEN 서버 내부 오류가 발생하면, THE Backend_Server SHALL 500 상태 코드를 반환하고 에러 상세를 로그에 기록하며 클라이언트에는 일반 에러 메시지를 반환한다.
6. THE Backend_Server SHALL 모든 API 요청에 대해 요청 ID를 생성하고 응답 헤더에 포함한다.

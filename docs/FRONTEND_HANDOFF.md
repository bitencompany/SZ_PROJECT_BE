# 이름결 프론트엔드 후속 작업

전달일: 2026-10-30. BE 저장소 `SZ_PROJECT_BE`. 사용자 결정: **PG 계약 전이므로 결제는 비활성으로 유지**.

2026-11-04 설정 진행: Supabase 원격 migration 2개·14개 테이블 적용, BE 연결·RLS 검증, FE 로컬 연결 설정 완료. Supabase·카카오 로그인 공급자, 콜백 주소와 프로필 선택 동의 설정을 저장했습니다. 로컬 OAuth 시작·취소 HTTP 검증은 통과했고 실제 계정 로그인 E2E 검증은 남아 있습니다. 실제 프로젝트 주소·검증 결과·남은 작업은 [SUPABASE_SETUP_STATUS.md](./SUPABASE_SETUP_STATUS.md)를 확인하세요. 아래 표의 10월 30일 환경 준비 상태보다 해당 문서가 최신입니다.

이 문서는 BE 구현 후 FE에서 진행할 작업입니다. FE 코드 자체는 이번 작업에서 변경하지 않았습니다. BE 상세 명세는 `SZ_PROJECT_BE/docs/BACKEND_API.md`, 설정 절차는 `SZ_PROJECT_BE/docs/OPERATIONS_SETUP.md`를 기준으로 합니다.

## 현재 사용할 수 있는 범위와 선행 조건

| 항목           | BE 상태                                                            | FE 조치                                                                 |
| -------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| 한자·이름 API  | 스키마/계산/검수 데이터 반입 도구 구현. 실제 전체 검수 데이터 없음 | `BACKEND_NAME_ENABLED=false` 유지. 검수 데이터 반입·계약 테스트 후 true |
| 비회원 사주    | `/api/sazu/preview` 구현. 기본 비활성, 실키/DB 미설정              | 신규 BFF 계약 구현 후 스테이징에서 실호출 검증                          |
| 로그인         | BE Supabase JWT 검증 구현. 신규 프로젝트·카카오 앱 없음            | 기존 OAuth 구현 유지, 신규 프로젝트 설정 및 실제 성공/취소/만료 검증    |
| 입력 보관      | BE 저장/조회/삭제 구현. 미구매 30일, 계정당 100건                  | Supabase 직접 insert를 BE 호출로 교체                                   |
| 주문·결제      | 상태 처리 코어 구현. 실제 PG 어댑터 없음                           | 결제 버튼/PG SDK 연결 금지. 준비 중 표시 유지                           |
| 내 풀이함/상세 | 본인+paid 조회, 생성 재시도 구현. 실제 결제 결과 없음              | BE 조회 방식으로 전환, 상태 UI 준비                                     |
| AI             | OpenAI 구조화 응답/재시도/결과 저장 구현. 키·모델 실검증 없음      | HTML 없이 텍스트 렌더링, failed에서 서버 작업 재시도                    |

## 1. FE 서버 환경변수와 공통 어댑터

```dotenv
APP_URL=http://127.0.0.1:3000
SUPABASE_URL=https://PROJECT.supabase.co
SUPABASE_PUBLISHABLE_KEY=
BACKEND_API_URL=http://127.0.0.1:3017
BACKEND_NAME_ENABLED=false
BFF_SHARED_SECRET=
```

BFF_SHARED_SECRET는 BE와 동일한 서버 비밀입니다. NEXT_PUBLIC_ 금지. DB 연결/SAZU/OpenAI/PG/WORKER/CRON 키는 FE에 두지 않습니다.

신규 BE API 요청마다 `X-BFF-Secret`을 명시적으로 추가합니다. 회원 API는 FE 서버에서 `getUser()`로 검증한 세션의 access token을 `Authorization: Bearer ...`로 추가합니다. 브라우저가 보낸 userId, paid, 획수, BFF 헤더를 전달하지 않습니다. 원본 Cookie/Origin을 전달하지 않고 새 fetch를 만들며 `cache:"no-store"`를 사용합니다.

BE는 ES256/RS256 JWKS만 허용합니다. Supabase 프로젝트의 JWT signing key 설정을 확인합니다. 이메일 유무로 사용자 존재/권한을 판단하지 않습니다.

## 2. `/api/reading-requests` 저장 경로 우선 교체

두 번째 BE migration부터 Supabase `authenticated`의 직접 insert 권한이 없어집니다. **FE 새 BFF 배포와 migration을 함께 조율하세요.**

브라우저 입력 계약은 기존 그대로이며 `previewId?:UUID`만 추가합니다.

```json
{
  "requestId": "UUID",
  "name": "김서준",
  "hanjaIds": ["김-金", "서-書", "준-俊"],
  "birth": {
    "birthDate": "1998-05-19",
    "birthTime": "10:00",
    "gender": "male",
    "birthCity": "서울",
    "consent": true
  },
  "consentToSave": true,
  "previewId": "선택-UUID"
}
```

이름 전용은 birth=null. 시간 미상은 birthTime=null. 실제 본문 4,096바이트 이하.

- 동일 입력 재시도는 같은 requestId를 유지합니다. 입력 변경 시 새 UUID를 만듭니다. 변경 입력+같은 UUID는 409입니다.
- 성공은 `{data:{requestId,paymentAvailable:false}}`. 현재 결제 준비 UI를 유지합니다.
- 저장은 최대 100건, 시간당 시도 30회. 429는 안내 후 사용자 재시도, 무한 재시도 금지.
- 로그인 후 입력 조회는 `GET /api/reading-requests/:id`, 미구매 삭제는 `DELETE` 같은 경로.
- 복원한 입력의 외부 제공 동의를 자동으로 체크하지 않습니다. 로그인 전 sessionStorage 30분 복원 로직을 유지합니다.

## 3. 사주 어댑터를 신규 미리보기로 변경

기존 `/api/sazu`의 production 차단을 단순 삭제하지 않습니다. FE 서버가 BE의 `/api/sazu/preview`로 아래를 보내도록 새 경로를 구성합니다.

```ts
{
  birth: {birthYear,birthMonth,birthDay,birthHour,birthMinute,
    isFemale,isLunar:false,isLeapMonth:false,birthCity,trueSolarTime:false},
  consent:true
}
```

헤더:

```text
Content-Type: application/json
X-BFF-Secret: 서버 공유 비밀
X-Client-IP: 신뢰 배포 프록시에서 얻은 실제 단일 IP
X-Anonymous-ID: FE가 발급한 익명 세션 UUID
```

익명 ID는 FE 서버가 발급한 HttpOnly/SameSite 쿠키로 유지합니다. 브라우저 입력의 X-Client-IP, X-Anonymous-ID, X-BFF-Secret을 그대로 사용하지 않습니다. 배포 사업자의 신뢰 IP 헤더를 서버에서 선택하고 클라이언트가 임의로 추가한 Forwarded/X-Forwarded-For 첫 값을 신뢰하지 않습니다. 신뢰할 수 있는 IP를 얻지 못하면 유료 공급자 호출을 차단합니다. BE는 이 경계를 BFF 공유 비밀로 인증합니다.

응답의 기존 `source/sandbox/modules` 외에 `previewId`, `expiresAt`, `providerVersion`을 보관합니다.

- 이름/생년월일을 URL이나 로그에 넣지 않습니다. previewId도 공유 링크로 노출하지 않습니다.
- previewId는 30분 유효하며 결제 권한이 아닙니다. 입력이 바뀌면 기존 결과와 previewId를 함께 초기화합니다.
- 로그인 후 요청 저장에 previewId를 전달합니다. 만료/불일치는 BE에서 재사용하지 않습니다.
- 미리보기는 fourPillars/elements만 받습니다. 신강약·대운이 없다는 이유로 오류를 만들지 않습니다.
- sandbox=true는 고정 샘플 문구 유지. 시주 null/오행 미제공을 임의 값으로 채우지 않습니다.
- 기본 IP 20회/시간, 익명 세션 10회/시간. 429/503/504 상태를 각각 표시합니다.
- `PREVIEW_ENABLED=true`는 BE 환경변수입니다. DB·실키·동의·신뢰 IP 전달까지 검증한 뒤 운영 차단을 교체합니다.

## 4. 한자·성명학 연결

`/api/hanja`, `/api/name`의 데이터 구조는 FE `src/lib/name-contract.ts`와 같습니다. 새 `X-BFF-Secret`만 추가하고, BE 활성 카탈로그의 실제 데이터를 확인한 뒤 `BACKEND_NAME_ENABLED=true`로 변경합니다.

한자 자료가 없으면 503 CATALOG_NOT_READY입니다. 예시로 자동 fallback하지 않습니다. 원획/사전 총획, strokeReview, strokeSources, catalog.version/status를 그대로 표시합니다. null인 자원오행/불용을 '없음'으로 바꾸지 않습니다. 19/18/17/27 및 81/82/161 테스트를 유지합니다.

## 5. 내 풀이함·주문 상태 UI

인증 BFF를 추가해 조회를 BE로 통일합니다. 기존 Supabase SELECT RLS도 유지되지만 한 화면에서 두 조회 경로를 혼용하지 않습니다.

- `GET /api/readings?page=0`: `{data:[{id,subjectName,title,createdAt}],nextPage}`. 20건/페이지, ID로 중복 제거.
- `GET /api/readings/:id`: `{data:{id,subjectName,content,createdAt,provenance}}`.
- content는 기존 `{title,summary,sections:[{heading,body}]}`. HTML 사용 금지.
- `GET /api/orders/:id`: `{data:{orderId,status,amount,currency,generationStatus,readingId}}`.
- pending의 generationStatus=null. paid 이후 queued/processing/ready/failed를 표시합니다.
- queued/processing만 제한적으로 폴링(예: 3초 간격, 화면 이탈 시 중지). ready+readingId이면 이동합니다.
- failed이면 `POST /api/orders/:id/retry` 호출 후 상태를 다시 조회합니다. 결제를 다시 요청하지 않습니다.
- cancelled/refunded에서는 기존 결과 UI/메모리 캐시를 제거합니다. 결과 404는 타인/환불 여부를 구별해 노출하지 않습니다.

## 6. PG 계약 이후 별도 연결

지금은 결제 UI 비활성을 유지합니다. POST orders/confirm/webhook은 503 PAYMENT_NOT_READY입니다. `paymentAvailable`을 FE에서 true로 바꾸지 않습니다.

BE의 예약된 주문 입력 `{requestId,productCode,idempotencyKey}`와 승인 입력 `{orderId,paymentToken}`을 지금 PG SDK 계약으로 가정하지 마세요. NICE/카카오페이 결정, 서버 가격·상품 등록, PG 승인/취소/웹훅 어댑터와 실거래 검증 후 최종 결제 준비정보를 재전달합니다.

## FE 인수 테스트

1. 비회원 입력 → 미리보기 → 카카오 로그인 성공/취소/만료 → 입력 복원. 외부 동의는 재확인.
2. 이메일 없는 카카오 계정, 로그아웃/재로그인, 다른 계정의 요청/결과 404.
3. 한자 없음/동음이자/미검수/원획과 사전 총획 차이/오행 null 표시.
4. 시간 미상, 샘플, 선택 모듈 누락, 429/타임아웃, 입력 변경 시 결과·previewId 초기화.
5. 동일 requestId 재전송 성공, 변경 409, 실제 4,096바이트 제한, 미구매 삭제.
6. 결제 비활성 표시. 후속 PG 연결 시 중복 클릭/웹훅/승인 재전송/생성 실패/환불 회수 검증.

BE 자동 테스트는 합성 공급자 응답과 PGlite PostgreSQL을 사용합니다. 실제 Supabase/OAuth/SAZU/PG/LLM 성공 또는 다중 연결 PostgreSQL 부하 검증을 뜻하지 않습니다.

# 이름결 운영 준비와 배포 절차

2026-10-30. 코드 구현과 실제 서비스 개통을 구분합니다. 이번 작업에서는 원격 프로젝트 생성, 비용 결제, 배포, 실거래, 실사용자 OAuth를 실행하지 않았습니다.

## 가입·생성할 서비스

현재 Next.js FE/BE 구조에는 **Vercel + Supabase**를 권장합니다. 이 구성이면 AWS/GCP를 별도로 계약할 필요가 없습니다. [Supabase의 Next.js/Vercel 연결 안내](https://supabase.com/kb/faqs/database/nextjs-on-vercel)

| 순서 | 서비스               | 준비할 것                                                            | 담당 기능                           |
| ---- | -------------------- | -------------------------------------------------------------------- | ----------------------------------- |
| 1    | Supabase             | 이름결 전용 프로젝트, DB 연결, 비대칭 JWT signing key                | 회원 인증, PostgreSQL, RLS          |
| 2    | Kakao Developers     | 앱, 카카오 로그인, 웹 도메인, redirect URI                           | 로그인                              |
| 3    | SAZU                 | 계정, 실제 개인 분석 가능한 API 키·요금/호출 한도                    | 사주 원국 계산                      |
| 4    | Vercel               | FE/BE 각각 프로젝트, 서버 환경변수, 상업 운영/분 단위 Cron 지원 플랜 | 웹/API 배포, 생성 worker, 보관 정리 |
| 5    | OpenAI API           | 프로젝트, API 키, 사용 요금/지출 제한, 테스트한 모델 버전            | 상세 텍스트 해설                    |
| 6    | 도메인 등록 서비스   | 서비스 도메인과 DNS 설정. 기존 도메인 재사용 가능                    | 운영 주소                           |
| 이후 | NICE 또는 카카오페이 | 계약/가맹 절차, 테스트 키, 실제 승인/취소/웹훅 검증                  | 결제. 사용자 결정으로 현재 보류     |

공식 설정 자료: [카카오 OAuth/Supabase](https://supabase.com/docs/guides/auth/social-sign-in/auth-kakao), [SAZU API](https://www.sazu.app/manse-api/docs), [Vercel Hobby의 사용 범위](https://vercel.com/docs/plans/hobby), [Vercel Cron 인증/운영](https://vercel.com/docs/cron-jobs/manage-cron-jobs), [OpenAI API 시작](https://developers.openai.com/api/docs/quickstart), [NICE 계약 안내](https://www.nicepay.co.kr/apply/guide/fee.do), [카카오페이 온라인 결제](https://developers.kakaopay.com/docs/payment/online/common).

카카오 로그인 앱 생성과 카카오페이 가맹은 별도 작업입니다. API 키는 채팅/문서로 전달하지 않고 각 프로젝트의 서버 환경변수에 저장합니다. 자세한 비용은 가입 시 선택한 플랜과 사용량으로 확인합니다.

## 이번 구현과 미완료 항목

| 요청 영역 | 구현                                                                  | 외부 준비/추가 검증 필요                                                                        |
| --------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 인증      | JWKS ES256/RS256, issuer/audience/서명/만료/역할, 계정 ID 소유권 검사 | 신규 Supabase/카카오 설정, OAuth 성공·취소·만료·이메일 없음 검증                                |
| 한자      | DB, 출처·원획 규칙·이체자·검수 메타데이터 반입 도구, 조회 API         | **전체 인명용 한자 및 원획 검수 데이터 확보/반입 미완료**. 자료 이용 조건/기준/완전성 사람 검수 |
| 성명학    | FE 81수리 자료 복제, 원형이정/발음오행/방향/서버 재계산               | 운영 카탈로그와 실제 계약 검증                                                                  |
| 사주      | 운영 미리보기, HMAC 입력, TTL, DB 기반 제한/중복 병합                 | SAZU 실키/실응답, 공급자 버전 확인, FE 신뢰 IP 헤더 검증                                        |
| 입력      | BE 저장/조회/미구매 삭제, 불변성/횟수/건수 제한                       | 원격 migration 적용, FE 직접 insert 교체                                                        |
| 결제      | 예약 API, 서버 가격/멱등 주문/스냅샷/이벤트/환불 상태 코어            | **PG 어댑터 미구현**, 상품 가격 미정, 계약 전 비활성 유지                                       |
| 결과·AI   | paid 소유권 조회, OpenAI JSON 응답 검증, 작업 lease/재시도/출처 저장  | 실제 모델·품질 검수, PG와 전체 흐름 검증                                                        |
| 보관      | 미리보기 30분, 미구매 입력 30일 정리와 사용자 삭제                    | 주문 연결 입력/결과/결제기록의 보관·삭제 정책 및 실행 절차 확정                                 |

예시 카탈로그/합성 사주/테스트 가격은 운영 DB에 넣지 않았습니다. 테스트 데이터는 tests 파일 안에서만 생성합니다.

## 환경변수

`.env.example` 참조. FE와 BE에 같은 SUPABASE_URL을 사용합니다.

| 변수                          | 설정                                                                                                                   |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| SUPABASE_URL                  | 신규 프로젝트 URL. production HTTPS                                                                                    |
| DATABASE_URL                  | BE 전용 PostgreSQL 연결. 런타임은 모든 쿼리에 `SET LOCAL ROLE service_role` 적용. 연결 계정은 해당 role 전환 권한 필요 |
| BFF_SHARED_SECRET             | FE 서버와 공유할 32바이트 이상 무작위 비밀                                                                             |
| INPUT_HASH_SECRET             | 입력/IP HMAC용 별도 비밀. 키 교체 시 기존 preview 매칭 무효화 고려                                                     |
| SAZU_API_KEY                  | 실제 발급 키. sazu_free_ 키는 샘플로 표시하고 유료 처리 거절                                                           |
| PREVIEW_ENABLED               | 기본 false. DB/키/동의/BFF IP 전달 확인 후 true                                                                        |
| SAZU_DAILY_CALL_BUDGET        | 기본 100. UTC 일별 신규 미리보기 예산 예약 횟수                                                                        |
| OPENAI_API_KEY / OPENAI_MODEL | 실제 계정 키와 테스트 완료한 모델 버전. 기본 모델 없음                                                                 |
| LLM_DAILY_CALL_BUDGET         | 기본 50. 자동/수동 재시도 포함. 출력 최대 6,000토큰/회                                                                 |
| WORKER_SECRET                 | 내부 POST 작업용 별도 비밀                                                                                             |
| CRON_SECRET                   | Vercel Cron GET 인증용 별도 비밀                                                                                       |

서버리스에서는 Supabase transaction pooler와 `prepare:false` 설정을 사용합니다. DB 연결 값은 BE 서버에서만 보관합니다. 원격 DB TLS를 사용하고 인증서 검증을 끄지 않습니다. 런타임 role 전환이 불가능하면 실패하며 소유자 권한으로 조용히 대체하지 않습니다. Supabase service_role HTTP 키는 현재 직접 PostgreSQL 연결 방식에서는 필요하지 않습니다.

BE DB 풀은 프로세스당 최대 5개 연결입니다. 인스턴스 증가 시 전체 연결/트래픽 예산을 조정해야 합니다. 캐시 미스의 호출 예산은 외부 호출 전에 별도 커밋하며, 동시 중복 대기 요청은 보수적으로 예산을 소비할 수 있습니다. 공급자 실패로 예산이 환원되지 않습니다. 금액 기준 사용 상한은 SAZU/OpenAI 대시보드에서도 설정합니다.

## 마이그레이션

1. 원격 DB 백업/프로젝트 대상 확인.
2. FE의 저장 BFF 교체 배포 시점을 조율. 002에서 authenticated INSERT가 회수됩니다.
3. `.env.local`에 마이그레이션용 소유자 DB 연결을 설정한 별도 관리자 환경에서 실행합니다. 런타임 설정과 관리 권한을 구분합니다.

신규 Supabase 프로젝트:

```sh
npm ci
npm run db:migrate
npm run db:migrate -- --apply
```

기존 FE `202610300001_readings.sql`을 이미 적용한 프로젝트:

```sh
npm run db:migrate -- --adopt-fe-base --apply
```

adopt 옵션은 초기 테이블의 존재를 검사하고 원본 파일 체크섬을 기준으로 이력을 등록합니다. **기존 스키마/정책/외래키가 FE 원본과 같은지는 관리자가 먼저 비교해야 합니다.** 임의 변경 스키마를 자동 복구하지 않습니다. SQL 두 파일을 Supabase SQL Editor에 순서대로 적용할 수도 있으나 적용 이력을 별도로 관리하세요. 001을 기존 테이블 위에 다시 실행하지 않습니다.

CLI는 외부 트랜잭션과 적용 이력 체크섬을 사용하며 실패 시 전체 롤백합니다. 기존 적용 파일을 고치지 말고 후속 migration을 추가합니다. 실제 운영 DB 적용은 아직 수행하지 않았습니다.

## 카탈로그 반입

출처 검수자가 완성한 JSON을 준비합니다. 형식은 `src/lib/backend/catalog.ts`의 `catalogImportSchema`가 기준입니다.

```ts
{
  catalog:{status:"preview"|"verified",version:string},
  metadata:{scope:"full-personal-name-catalog",sourceVersion:string,
    license:string,reviewedAt:"YYYY-MM-DD",rules:string},
  entries:[{
    entry:Hanja,
    evidence:{registrationSource:"https://...",license:string,
      reviewedAt:"YYYY-MM-DD",reviewer:string,originalStrokeRule:string,
      radicalAdjustment:string,variantOf:string|null,
      elementEvidence:string|null,bulyongEvidence:string|null}
  }]
}
```

```sh
npm run catalog:import -- /secure/path/catalog.json
# 검토 후 즉시 활성화하는 새 버전 반입
npm run catalog:import -- /secure/path/new-catalog.json --activate
```

- 버전 중복, ID 중복, 음별 2,000자 초과, 검수 근거 누락을 거절합니다. 기존 버전은 수정할 수 없습니다.
- verified는 원획/사전 출처와 dictionaryStrokes, 검수 상태를 모두 요구합니다.
- 데이터 파일의 'full' 표시나 URL 형식 검사는 실제 전체 목록/출처의 정확성을 보증하지 않습니다. 법원 등록 목록과 원획 자료는 별도로 검수해야 합니다.
- 라이선스, 검수일/담당자, 원획 적용 규칙, 이체자/부수 보정 근거를 보관합니다. 근거 없는 오행/불용은 null.
- 泰 9/10, 玉 오행 충돌 등은 임의로 확정하지 않습니다.
- 현재 실제 데이터가 없어 `/api/hanja`, `/api/name`은 연결 환경에서 CATALOG_NOT_READY입니다. FE는 BACKEND_NAME_ENABLED=false 유지.

## 배포와 작업 스케줄

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm run start -- --hostname 127.0.0.1 --port 3017
```

Vercel에 FE와 BE를 서로 다른 프로젝트로 연결합니다. BE 환경변수를 먼저 설정하고 FE BACKEND_API_URL을 해당 HTTPS 주소로 설정합니다. 테스트/운영 프로젝트 및 DB를 분리합니다. 미리보기 배포에도 유료 운영 키를 자동 주입하지 않습니다.

`vercel.json`은 생성 작업을 매분, 보관 정리를 매일 한국 시간 03:00에 호출하도록 정의합니다. CRON_SECRET가 없거나 불일치하면 작업은 실행되지 않습니다. Cron은 배포 후 활성화되므로 배포 전에 대상 DB와 환경변수를 검토합니다. 로컬에서는 스케줄이 자동 실행되지 않습니다. 매분 스케줄을 지원하는 요금제를 사용합니다.

외부 스케줄러를 선택하면 같은 내부 API에 WORKER_SECRET Bearer로 POST하고 `vercel.json`의 Cron을 제거해 한 곳에서 관리합니다. 요청당 최대 한 작업이므로 처리량을 늘릴 때 호출 주기/worker 수와 DB 풀/공급자 예산을 함께 조정합니다. 오래된 작업 lease는 회수되며 3회 실패는 failed, 명시적 재시도는 paid 상태에서만 허용합니다.

생성 worker는 LLM에게 원본 생년월일/계정 ID를 보내지 않고 계산 결과와 분석 대상 이름을 전달합니다. `store:false`를 사용하지만 공급자 데이터 보관 정책 전체를 대체하지는 않습니다. 출시 시 외부 제공 안내에 실제 공급자와 전송 항목을 반영합니다. 모델 응답 형식 검증은 내용의 사실성/해석 품질을 보증하지 않으므로 실제 응답 검수가 필요합니다. [OpenAI 구조화 응답 문서](https://developers.openai.com/api/docs/guides/structured-outputs)

## PG 계약 후 이어서 할 BE 작업

현재 `paymentProvider()`는 항상 PAYMENT_NOT_READY를 반환합니다. 이를 환경변수로 우회하는 기능은 없습니다.

1. NICE/카카오페이 계약 선택, 운영 상품/가격/환불 정책 확정.
2. `PaymentProvider`의 prepare/confirm/verifyWebhook/refund를 실제 공식 API로 구현. 승인 전 서버 조회·승인/취소 멱등성, 금액/통화/orderId 검증. 응답 유실 후 PG 조회로 복구.
3. 웹훅 서명과 공급자 최신 상태 재조회, 이벤트 ID 중복 제거. 이벤트 ID가 없는 공급자는 검증된 거래/이벤트 필드의 안정적인 키 정의. 공급자별 성공 응답 형식 구현.
4. PG timeout/부분 취소/비동기 환불 상태를 실제 계약에 맞게 확장. 현재 코어는 전체 paid/cancelled/refunded만 지원하며 부분 환불은 아직 지원하지 않음.
5. 승인 직후 BE DB 장애 및 웹훅 유실을 대비한 **PG 대사 작업** 구현. 현재 PG 조회/대사 worker는 미구현.
6. 테스트 승인·취소·중복·순서 역전·DB 장애 복구 검증, 실제 최소 금액 승인/취소를 별도 승인된 범위에서 실행.
7. 테스트 완료 후 paymentAvailable 계산과 provider registry, FE PG 화면 계약을 함께 변경.

## 검증 범위와 출시 전 확인

자동 테스트: 기존 SAZU 응답 계약, 이름 계산 경계값, 실제 PostgreSQL(PGlite)의 마이그레이션/RLS/불변성/상태 전환, 테스트용 공급자의 승인/환불/생성 실패, JWT 검증.

PGlite는 단일 연결이므로 다중 연결 잠금/네트워크 장애/원격 연결 풀을 검증하지 않습니다. 운영 PostgreSQL에서 동일 입력 동시 호출·동일 주문 승인/웹훅 경합·worker 중복 실행·환불 중 생성·풀 고갈·공급자 타임아웃을 검증해야 합니다.

실키/OAuth/원격 Supabase/실제 PG/LLM 품질 검증은 미완료입니다. 주문 연결 데이터 보관/삭제와 계정 탈퇴 절차는 출시 전에 확정·구현해야 합니다. 결제가 비활성인 현재 상태에서는 미구매 요청의 30일 정리와 사용자 삭제를 사용할 수 있습니다.

## 이번 작업의 로컬 검증 결과

- `npm run lint`: 통과.
- `npm run typecheck`: 통과.
- `npm test`: 2개 파일, 43개 테스트 통과.
- `npm run build`: 통과. 신규 API 포함 프로덕션 Route Handler 생성 확인.
- `git diff --check`: 통과.
- `src/data/suri_81.json`: FE 원본과 바이트 일치 확인.

실환경 배포/원격 migration/실키 호출은 실행하지 않았습니다.

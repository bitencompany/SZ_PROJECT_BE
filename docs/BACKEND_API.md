# 이름결 백엔드 API 계약

작성: 2026-10-30. 이전 개발용 문서를 대체합니다. 구현 저장소 `SZ_PROJECT_BE`.

**PG 계약 전이므로 실제 결제는 비활성입니다.** 주문/승인/웹훅/환불의 운영 어댑터는 아직 없습니다. 결제·생성 상태 처리 코어는 테스트용 PG를 주입하여 검증합니다. 환경변수만으로 실제 결제를 활성화할 수 없습니다.

## 공통 연결

브라우저 → FE 같은 출처 BFF → BE. 개발 주소 `http://127.0.0.1:3017`.

| 구분                                       | FE 서버가 BE에 보내는 헤더                                                                           |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| 신규 비회원 API(`/api/hanja`, `/api/name`) | `X-BFF-Secret: <공유 서버 비밀>`                                                                     |
| 신규 미리보기                              | 위 헤더 + `X-Client-IP: <신뢰 프록시에서 얻은 단일 IP>` + `X-Anonymous-ID: <FE 발급 익명 세션 UUID>` |
| 회원 API                                   | `X-BFF-Secret` + `Authorization: Bearer <Supabase access token>`                                     |
| JSON POST                                  | `Content-Type: application/json` 추가                                                                |
| 내부 수동 작업 POST                        | `Authorization: Bearer <WORKER_SECRET>`; FE 호출 금지                                                |
| 내부 Cron GET                              | `Authorization: Bearer <CRON_SECRET>`; FE 호출 금지                                                  |

`BFF_SHARED_SECRET`은 FE/BE 서버에만 설정합니다. 브라우저가 보낸 같은 이름의 헤더를 복사하지 않습니다. 원래 Cookie/Origin/Authorization을 무조건 전달하지 않고 새 요청을 만듭니다. 회원 access token은 FE 서버가 세션 검증 후 명시적으로 선택합니다. BE도 JWKS의 ES256/RS256 서명, issuer, audience=`authenticated`, exp, iat, sub(UUID), role을 검사합니다. 이메일은 필요하지 않습니다. HS256/익명 Supabase 로그인은 이 계약에서 지원하지 않습니다.

JSON POST 본문은 실제 바이트 기준 최대 4,096바이트입니다. 추가 입력 필드를 거절합니다. 이름/출생정보/토큰/외부 응답 원문은 로그에 넣지 않습니다. 모든 API 응답은 `Cache-Control: no-store, private`이며 FE도 캐시하지 않습니다.

오류 형식:

```json
{
  "success": false,
  "error": { "code": "INVALID_INPUT", "message": "입력 정보를 확인해 주세요." }
}
```

| HTTP      | 대표 코드                                                                                         | FE 처리                                                                         |
| --------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 400       | INVALID_INPUT / INVALID_JSON / INVALID_VISITOR / HANJA_MISMATCH                                   | 입력/프록시 설정 확인                                                           |
| 401       | UNAUTHORIZED                                                                                      | 다시 로그인, 임시 입력 유지                                                     |
| 403       | FORBIDDEN / PAYMENT_REQUIRED                                                                      | 서버 연결/권한 확인                                                             |
| 404       | NOT_FOUND                                                                                         | 없는 데이터와 타인 데이터를 구분해 노출하지 않음                                |
| 409       | REQUEST_CONFLICT / IDEMPOTENCY_CONFLICT / ORDER_EXISTS                                            | 기존 요청을 수정하지 말고 새 UUID 사용 또는 기존 주문 조회                      |
| 409       | UNVERIFIED_CATALOG / SAMPLE_NOT_PAYABLE / PRODUCT_NOT_AVAILABLE                                   | 결제 진행 금지                                                                  |
| 409       | ORDER_LINKED_REQUEST                                                                              | 주문 연결 입력의 삭제는 별도 지원 절차                                          |
| 413 / 415 | BODY_TOO_LARGE / INVALID_CONTENT_TYPE                                                             | 본문 형식 수정                                                                  |
| 429       | RATE_LIMITED / REQUEST_LIMIT                                                                      | Retry-After(60초)를 안내. 장기 한도가 남아 있으면 재시도해도 계속 429일 수 있음 |
| 503       | NOT_CONFIGURED / CATALOG_NOT_READY / PREVIEW_NOT_READY / PAYMENT_NOT_READY / GENERATION_NOT_READY | 준비 중 안내, 샘플로 조용히 대체하지 않음                                       |
| 502 / 504 | 공급자 응답/연결 오류                                                                             | 입력 유지, 사용자에게 재시도 제공                                               |

## GET /api/hanja

`?reading=태&q=`. reading=한글 한 음절, q=최대 40자. 의미/글자 부분 문자열 검색. 음별 최대 2,000자. 결과가 없으면 `data:[]`.

응답 스키마는 `src/lib/name-contract.ts`이며 FE에서 가져온 계약과 동일합니다.

```ts
{ data: Hanja[]; catalog: { status: "preview" | "verified"; version: string } }
```

원획 `strokes`와 사전 총획 `dictionaryStrokes`는 별도 값입니다. 미확인 오행/불용은 null입니다. DB 활성 카탈로그가 없으면 503 CATALOG_NOT_READY. 현재 운영 데이터는 반입하지 않았습니다. 예시 한자를 자동으로 채우지 않습니다.

## POST /api/name

```json
{ "name": "김서준", "hanjaIds": ["김-金", "서-書", "준-俊"] }
```

서버 DB의 동일 카탈로그 버전에서 원획을 조회합니다. 이름의 각 음과 ID의 음을 비교합니다. 클라이언트 획수/오행/길흉은 받지 않습니다. 원/형/이/정 순서, 발음오행/상생·상극 방향, 81 경계값은 요청서와 같습니다. 수리 자료는 FE `suri_81.json`의 2026-10-30 버전입니다.

```ts
{ data: {
  name: string; hanja: Hanja[];
  grids: { label:string; period:string; total:number; number:number;
    title:string; fortune:string; description:string }[];
  sounds: { syllable:string; element:"목"|"화"|"토"|"금"|"수"|null }[];
  relations: string[];
}; catalog: { status:"preview"|"verified"; version:string } }
```

## POST /api/sazu/preview — 신규 운영용 미리보기

```json
{
  "birth": {
    "birthYear": 1998,
    "birthMonth": 5,
    "birthDay": 19,
    "birthHour": null,
    "birthMinute": 0,
    "isFemale": false,
    "isLunar": false,
    "isLeapMonth": false,
    "birthCity": "서울",
    "trueSolarTime": false
  },
  "consent": true
}
```

현재 미리보기는 양력·표준시만 지원합니다. 도시 지원 여부는 SAZU가 검증하며 FE는 기존 국내 도시 선택 UI를 유지합니다. 시간 미상은 null/0입니다. 이름은 보내지 않습니다. `PREVIEW_ENABLED=true`와 DB/키/신뢰 BFF 헤더가 필요합니다.

```ts
{ success:true; data: {
  source:"SAZU"; sandbox:boolean;
  modules:{
    fourPillars:{year:Pillar;month:Pillar;day:Pillar;hour?:Pillar|null};
    elements?:Record<string,{name:string;total:{count:number}}>;
  };
  previewId:string; expiresAt:string; providerVersion:string;
} }
type Pillar = { full:string; sky?:string; earth?:string; skyElement?:string;
  earthElement?:string; sippiSeong?:string; twelveStage?:string };
```

- `sandbox=true`는 고정 샘플. 실제 개인 풀이로 표시하거나 결제할 수 없습니다.
- 시주 미상은 null로 유지. 오행 누락을 0으로 채우지 않습니다.
- 신강약·대운·AI 전체 해설은 신규 미리보기에서 반환하지 않습니다.
- previewId는 서버 UUID, 만료 30분. 입력 HMAC과 결과를 서버 저장합니다. 같은 입력은 DB 잠금으로 공급자 호출을 합칩니다. previewId 조회 공개 API는 없습니다.
- 기본 IP당 시간당 20회, 익명 세션당 시간당 10회. 서버 전체 SAZU 공급자 시도 기본 UTC 일당 100회(설정 가능). 이미 저장된 성공 캐시 재사용은 예산을 추가 사용하지 않습니다. 동시 캐시 미스는 호출 전 예산을 먼저 예약하므로 병합 대기 중인 요청도 보수적으로 예산을 소비할 수 있습니다. 사용자 한도는 캐시 요청에도 적용합니다.
- IP/익명 ID 헤더의 신뢰성은 FE BFF에서 보장해야 합니다. 공급자 예산은 시도 전에 별도 커밋하므로 실패해도 되돌리지 않습니다.

## POST /api/sazu — 기존 개발 계약 유지

기존 평탄한 BirthInput JSON(위 birth 객체 자체)을 받습니다. `consent`나 BFF 헤더를 요구하지 않는 개발 경로입니다. 기존 Origin/크기/오류 규칙을 유지하며 **production에서는 계속 503 PAYMENT_NOT_READY**입니다. 응답은 기존 `success/data/source/sandbox/modules` 구조이며 개발 경로에만 신강약/대운 선택 필드가 남습니다. 운영 FE는 반드시 새 `/api/sazu/preview`를 사용합니다.

## POST /api/reading-requests — BE 저장으로 전환

```json
{
  "requestId": "UUID",
  "name": "김서준",
  "hanjaIds": ["김-金", "서-書", "준-俊"],
  "birth": {
    "birthDate": "1998-05-19",
    "birthTime": null,
    "gender": "male",
    "birthCity": "서울",
    "consent": true
  },
  "consentToSave": true,
  "previewId": "선택-UUID"
}
```

birth는 이름 전용일 때 null. birthTime은 `HH:mm` 또는 null. previewId는 선택 사항이며 만료/불일치이면 연결하지 않습니다. 이후 주문 시 새 사주 결과가 필요합니다. 분석 대상은 로그인 사용자와 같을 필요가 없습니다.

```json
{ "data": { "requestId": "UUID", "paymentAvailable": false } }
```

동일 사용자·requestId·동일 입력은 기존 성공, 변경 입력은 409, 다른 사용자 ID는 404. 동의와 자료 버전을 저장하고 업데이트는 금지합니다. 계정당 100건, 시간당 저장 시도 30회. 카탈로그 미반입 상태에서도 입력 보관은 가능하나 결과/결제의 검증을 대신하지 않습니다.

**두 번째 마이그레이션은 authenticated의 직접 insert 권한을 회수합니다. FE의 기존 Supabase insert 경로를 BE POST로 교체해야 합니다.**

- `GET /api/reading-requests/:id`: `{data:{requestId,input,createdAt}}`.
- `DELETE /api/reading-requests/:id`: 주문 연결이 없을 때 `{data:{deleted:true}}`. 주문이 있으면 409.
- 미구매 입력은 30일 후 정리 작업 대상입니다. 저장된 consent 값을 새 외부 제공 동의 체크박스에 자동 복원하지 않습니다.

## 결제 API — 비활성 예약 계약

| 경로                       | 입력/응답                                                                  |
| -------------------------- | -------------------------------------------------------------------------- |
| POST /api/orders           | `{requestId,productCode,idempotencyKey:UUID}` → 현재 503 PAYMENT_NOT_READY |
| POST /api/payments/confirm | `{orderId,paymentToken:string}` → 현재 503 PAYMENT_NOT_READY               |
| POST /api/payments/webhook | PG별 원문/서명 계약 미확정 → 현재 503 PAYMENT_NOT_READY                    |
| POST /api/internal/refunds | 내부 작업 인증 + `{orderId}` → 현재 503 PAYMENT_NOT_READY                  |

주문/승인은 BFF+JWT 인증 뒤 비활성 오류를 반환합니다. 실제 공급자별 인증 식별자, 승인/취소 API, 서명과 재조회, 웹훅 응답 규격은 계약 이후 확정합니다. `paymentToken`과 payment 준비 객체는 예약된 인터페이스이며 FE 결제창을 지금 연결하지 않습니다.

내부 코어는 서버 상품 가격, 동일 계정 멱등 키, request 소유권, 검수 카탈로그, 비샘플 사주, 모델 설정을 검사한 후 불변 주문 스냅샷을 만듭니다. 승인 이벤트/주문 paid/작업 하나 등록을 한 트랜잭션으로 처리하며 취소/환불 이후 늦은 승인 이벤트로 권한을 복구하지 않습니다. PG가 없는 상태에서 주문/상품/paid 결과를 운영 DB에 수동 생성하지 않습니다.

## 주문 상태·결과 조회

`GET /api/orders/:id`:

```ts
{
  data: {
    orderId: string;
    status: "pending" | "paid" | "failed" | "cancelled" | "refunded";
    amount: number;
    currency: "KRW";
    generationStatus: null | "queued" | "processing" | "ready" | "failed";
    readingId: string | null;
  }
}
```

pending의 generationStatus는 null. 환불 시 readingId는 null. 자기 주문만 조회합니다.

`GET /api/readings?page=0`: `{data:[{id,subjectName,title,createdAt}],nextPage:number|null}`. 페이지당 20개, 최신순. 현재는 offset 방식이므로 조회 도중 새 결과가 추가되면 중복을 ID로 제거합니다.

`GET /api/readings/:id`: `{data:{id,subjectName,content,createdAt,provenance}}`.

```ts
type Content = {
  title: string;
  summary: string;
  sections: { heading: string; body: string }[];
};
```

본인+paid 조건을 SQL과 Supabase RLS 모두에서 검사합니다. 미결제/환불/타인/없는 결과는 404. HTML을 렌더링하지 않습니다. provenance에는 카탈로그/원획 출처, SAZU 계약 버전/샘플 여부, 수리 자료/프롬프트/요청 모델/실제 응답 모델을 기록합니다.

`POST /api/orders/:id/retry`: paid 주문의 failed 생성 작업을 queued로 되돌립니다. 계정당 시간당 5회. 재결제하지 않습니다. 성공 `{data:{orderId}}`, 상태는 GET으로 다시 읽습니다.

## 운영 작업

- `/api/internal/generation`: POST(WORKER_SECRET) 또는 GET(CRON_SECRET). 호출당 작업 최대 1개. 2분 lease와 토큰으로 중복 완료 차단, 외부 호출 45초 제한, 자동 최대 3회 시도(실패 후 1분 간격), 최종 실패는 사용자 재시도 가능. LLM 기본 UTC 일당 50회·호출당 출력 최대 6,000토큰. 공급자 사용 금액 상한도 별도로 설정합니다.
- `/api/internal/cleanup`: POST 또는 GET. 30분 만료 미리보기, 오래된 한도 버킷, 30일 지난 주문 없는 요청 삭제.
- `vercel.json`: 생성 매분, 정리 매일 18:00 UTC(한국 03:00). 실제 배포/스케줄 활성화는 아직 수행하지 않았습니다.
- 주문이 연결된 입력/결과/금융 기록의 보관·삭제 기간은 출시 전 확정해야 합니다. 현재 자동 파기는 미구매 입력과 미리보기만 대상으로 합니다.

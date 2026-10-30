# 이름결 백엔드 구현 요청서

작성일: 2026-10-30. 프론트 저장소: `SZ_PROJECT_FE`.

아래 사용자 흐름을 완성할 수 있도록 구현해 주세요. **비회원이 이름·한자·출생 정보를 입력하고 사주와 이름의 무료 미리보기를 확인한 뒤, ‘더 자세한 내용 보기’를 누르면 카카오 로그인 → 결제 → 해당 입력에 대한 상세 분석으로 진행합니다.** 로그인한 사람과 분석 대상은 다를 수 있습니다. 결제 후에는 같은 계정의 내 풀이함에서 다시 조회합니다.

## 1. 현재 구현과 남은 작업

| 항목 | 현재 FE 구현 | BE에서 필요한 작업 |
| --- | --- | --- |
| 로그인 | Supabase Auth 카카오 OAuth, PKCE 콜백, HttpOnly 쿠키, 로그아웃, 보호 페이지 | 신규 Supabase·카카오 앱 설정과 실제 OAuth 검증. BE 유료 API의 Supabase JWT 검증 |
| 한자 | `/api/hanja` 조회·선택, 뜻·음·획수·출처 표시 | 전체 인명용 한자 DB, 읽기/이체자, 원획과 사전 총획 분리, 출처·버전 검수 |
| 이름 분석 | `/api/name`, 원형이정·81수리·발음오행 계산, 무료 미리보기 | 검증된 DB로 서버 재계산. 예시 데이터를 운영 결과로 사용 금지 |
| SAZU | FE 서버 → BE `/api/sazu` 어댑터. 공급자 직접 호출 제거 | 기존 BE 실행 및 실제 키 확인. 운영 비회원 미리보기 계약·호출 제한 추가 |
| 입력 이어받기 | 같은 탭의 sessionStorage에 상세 보기 클릭 시 30분 동안 임시 보관 | 서버 저장 후 requestId 기준의 불변 분석 스냅샷 관리 |
| 계정 저장 | 로그인·동의 후 `/api/reading-requests`가 Supabase에 저장 | 마이그레이션 적용, 저장 건수/빈도 제한, 보관·삭제 정책과 작업 구현 |
| 결제 | 결제 준비 화면, 계정에 입력 보관. 실제 청구 버튼 없음 | 상품·서버 가격, 주문, PG 승인·취소·환불, 웹훅, 멱등성 |
| 상세 결과 | 본인 결제 완료 결과만 읽는 내 풀이함·상세 화면 | 결제 확인 후 SAZU/성명학/AI 결과 생성·저장, 작업 재시도 |

현재 실제 카카오 계정 로그인, 원격 DB 적용, SAZU 실호출, PG 결제, AI 생성은 검증 완료 상태가 아닙니다. 신규 인증 프로젝트와 키가 없으며, 개발 BE `127.0.0.1:3017`도 작업 시점에 실행 중이지 않았습니다.

## 2. 책임과 환경변수

브라우저는 FE의 같은 출처 API만 호출합니다. SAZU·LLM·PG 비밀 키와 Supabase service role 키는 BE에서 관리합니다.

FE 환경변수:

```dotenv
APP_URL=http://127.0.0.1:3000
SUPABASE_URL=https://PROJECT.supabase.co
SUPABASE_PUBLISHABLE_KEY=프로젝트의_publishable_key
BACKEND_API_URL=http://127.0.0.1:3017
BACKEND_NAME_ENABLED=false
```

`BACKEND_NAME_ENABLED=false`이면 한자/성명학에 출처 미검수 예시 데이터를 사용하고 화면에도 표시합니다. BE의 `/api/hanja`와 `/api/name`을 아래 계약대로 구현한 뒤 함께 true로 변경합니다. BE가 실패하면 예시로 조용히 대체하지 않습니다. 운영 APP_URL·BE 주소는 HTTPS여야 합니다.

기존 개발 `/api/sazu`는 `BACKEND_API.md`에 따라 새 JSON 요청만 전송하고, 브라우저의 Origin/Cookie/Authorization을 전달하지 않습니다. **이 개발용 계약을 그대로 유료 API에 사용하면 안 됩니다.** 유료 BE API에서는 FE가 서버에서 검증한 세션의 access token을 `Authorization: Bearer …`로 명시적으로 전달하고, BE도 Supabase issuer/audience/서명/만료를 검증해 사용자 ID를 얻어야 합니다. 브라우저 본문·임의 헤더의 userId를 신뢰하지 마세요. 이 인증 전달은 유료 BE API 구현과 함께 FE에도 추가해야 합니다.

## 3. 한자 조회: GET /api/hanja

쿼리: `reading=태&q=`. reading은 한글 한 음절, q는 선택 검색어(최대 40자). 의미·글자 검색을 지원해 주세요. 최대 2,000개까지 반환하는 계약이며, 그 이상 필요하면 페이지 계약을 먼저 협의해 주세요.

```json
{
  "data": [{
    "id": "태-泰",
    "reading": "태",
    "character": "泰",
    "meaning": "클",
    "strokes": 9,
    "dictionaryStrokes": 10,
    "strokeReview": "reference-checked",
    "strokeSources": [
      { "title": "원획 자료명", "url": "https://실제-출처-페이지", "basis": "naming-original" },
      { "title": "사전 자료명", "url": "https://실제-출처-페이지", "basis": "dictionary" }
    ],
    "element": null,
    "isBulyong": null
  }],
  "catalog": { "status": "verified", "version": "실제-검수-버전" }
}
```

위 URL과 version은 형태 설명용 자리표시자입니다. 실제 응답에는 확인 가능한 출처를 넣어 주세요. 스키마는 `src/lib/name-contract.ts`에 있습니다.

- `strokes`: 이 서비스가 선택한 **성명학 원획 기준**. `dictionaryStrokes`: 사전 총획. 서로 자동 대체하지 않습니다.
- `strokeReview`: `unreviewed` 또는 `reference-checked`. 미검수 시 출처 배열은 비어 있을 수 있으며 catalog는 `preview`여야 합니다.
- 대법원 인명용 등록 여부, 사전 총획, 성명학 원획, 자원오행은 서로 다른 데이터입니다. 인명용 목록만으로 원획 검수가 끝난 것으로 처리하지 마세요.
- 원획 출처, 이용 조건, 검수일, 적용 규칙, 이체자·부수 보정과 버전을 내부 DB에 보관하세요. 출시 전 선택한 기준을 확정해 주세요.
- 특히 泰는 일반 사전 총획 10과 국내 일부 작명 자료의 원획 9가 다릅니다. 기존 예시값의 최초 출처는 미기록이며, 2026-10-30에 자료를 대조했습니다. 단순 오타로 10으로 바꾸지 않았습니다.
- 자료: [교육부 사전 泰](https://dict.revised.moe.edu.tw/dictView.jsp?ID=2491&la=1&powerMode=0), [미소 한국작명원 泰](https://www.miso.co.kr/Resource/Hanja/pick-PAx4SWrQudQQ6RvTb3hWm9j2E2V5GO46v0-MS9PEjtI%21).
- 자원오행/불용문자 근거가 없으면 null입니다. null을 ‘해당 없음’으로 바꾸지 마세요. 玉의 자원오행은 기존 명세에서 토/금으로 충돌하므로 임의 판정하지 않습니다.

## 4. 이름 분석: POST /api/name

```json
{ "name": "김서준", "hanjaIds": ["김-金", "서-書", "준-俊"] }
```

성 1자+이름 2자의 한글 이름만 지원합니다. 획수·오행·길흉은 클라이언트에서 받지 않고 DB에서 조회합니다. 각 ID의 음이 이름의 해당 위치와 일치하는지 검증합니다.

성/이름1/이름2 원획을 S/A/B라 할 때 원격=A+B, 형격=S+A, 이격=S+B, 정격=S+A+B입니다. 81까지는 그대로, 초과는 80을 반복 차감합니다(81→81, 82→2, 161→81). `81.md`, `src/data/suri_81.json`을 기준으로 해설을 조회합니다. 분류 근거 없는 된소리는 null이며 상생/상극의 방향을 보존합니다.

성공 응답은 다음 TypeScript 형태입니다. 실제 Zod 스키마는 `src/lib/name-contract.ts`를 기준으로 구현해 주세요.

```ts
type NameResponse = {
  data: {
    name: string;
    hanja: Hanja[]; // 요청 순서의 3개. 3번 절의 한자 구조
    grids: { label: string; period: string; total: number; number: number;
      title: string; fortune: string; description: string }[]; // 원·형·이·정 순서 4개
    sounds: { syllable: string; element: "목"|"화"|"토"|"금"|"수"|null }[]; // 3개
    relations: string[]; // 성→이름1, 이름1→이름2 순서 2개
  };
  catalog: { status: "preview"|"verified"; version: string };
};
```

## 5. 무료 SAZU 미리보기

현행 BE 계약은 `BACKEND_API.md`의 POST `/api/sazu`입니다. FE는 `{birthDate,birthTime,gender,birthCity,consent:true}`를 받고 아래처럼 변환합니다.

```json
{
  "birthYear": 1998, "birthMonth": 5, "birthDay": 19,
  "birthHour": 10, "birthMinute": 0,
  "isFemale": false, "isLunar": false, "isLeapMonth": false,
  "birthCity": "서울", "trueSolarTime": false
}
```

시간 미상은 hour=null, minute=0입니다. 현재 화면은 양력·국내 도시만 지원합니다. 이름은 SAZU에 보내지 않습니다. 응답의 `data.sandbox`가 true면 고정 샘플로 표시하며 개인 분석이라고 표시하지 않습니다. 선택 모듈이 없으면 없다고 표시하고 오행 0개나 임의 시주를 만들지 않습니다.

**기존 BE와 FE는 production에서 SAZU를 차단합니다.** 사용자가 요청한 ‘로그인 전 사주 미리보기’를 출시하려면 BE에 다음 계약을 먼저 추가해 주세요.

1. 비회원 미리보기는 허용하되 IP/익명 세션별 지속형 제한, 공급자 호출 예산, 중복 요청 병합을 적용합니다.
2. 원국/오행 등 미리보기 필드만 반환합니다. 유료 AI 전체 해설은 반환하지 않습니다.
3. 미리보기 원국을 서버의 예측 불가능한 previewId 및 입력 해시·만료시각으로 보관해 결제 후 재사용할 수 있게 합니다. 생년월일·이름을 URL/로그에 넣지 않습니다.
4. previewId의 입력과 로그인 후 저장된 요청이 일치할 때만 재사용하고, 다르면 새 분석 요청으로 처리합니다. previewId 자체는 결제 권한이 아닙니다.
5. 이 계약을 확정하고 테스트한 후 FE `fetchSazu`의 운영 차단을 새 미리보기 호출로 교체합니다. 현재 화면은 해당 계약을 구현한 상태가 아닙니다.

## 6. 로그인 후 입력 연결

현재 FE POST `/api/reading-requests`:

```json
{
  "requestId": "브라우저에서-생성한-UUID",
  "name": "김서준",
  "hanjaIds": ["김-金", "서-書", "준-俊"],
  "birth": { "birthDate": "1998-05-19", "birthTime": "10:00", "gender": "male", "birthCity": "서울", "consent": true },
  "consentToSave": true
}
```

출생 정보 없는 이름 전용 요청은 birth=null입니다. 요청 ID는 동시 재시도 중복 저장을 방지하는 값이며 계정 권한을 대신하지 않습니다. FE 서버가 Supabase `getUser()`로 확인한 user.id를 넣습니다. JSON 최대 4,096바이트. 저장 동의와 SAZU 제공 동의는 분리합니다. 같은 requestId/동일 입력 재전송은 기존 성공으로 처리하고, 변경된 입력은 409입니다.

현재 성공 응답: `{ "data": { "requestId": "UUID", "paymentAvailable": false } }`.

DB 마이그레이션은 `supabase/migrations/202610300001_readings.sql`입니다. `reading_requests`(입력), `orders`(주문), `readings`(결과)가 user_id와 외래키로 연결됩니다. 사용자 인증은 auth.users를 사용합니다. 이 초기 스키마를 확장해 주세요.

- 로그인 전 임시 입력은 원본 화면으로 돌아오면 복원되며, 외부 제공 동의는 자동 복원하지 않습니다.
- 로그인 후에는 저장된 requestId로 다시 조회할 수 있습니다. 쿠키/이메일이 아닌 auth.users.id를 영속 식별자로 사용합니다.
- 현재 사용자는 자기 요청만 insert/select할 수 있습니다. 수정 권한은 없으며 변경 시 새 요청을 만듭니다. **DB에 저장된 input/catalog_status 자체는 신뢰된 계산 결과가 아닙니다.** 결제·생성 시 서버가 검증된 카탈로그로 재검증하고 고정 스냅샷을 보관하세요.
- 주문/결과 쓰기는 BE service_role만 사용합니다. FE에는 service_role 키가 필요하지 않습니다.

## 7. 결제와 상세 분석: 추가 구현할 계약

아래 API는 **요청하는 후속 계약이며 현재 FE에는 결제 호출이 구현되지 않았습니다.** BE 구현 완료 후 결제 화면에 연결해야 합니다.

| API 제안 | 입력 | 핵심 처리 / 응답 |
| --- | --- | --- |
| POST `/api/orders` | requestId, productCode, 멱등 키 | JWT 사용자 소유 요청 확인, 검증된 카탈로그만 허용, 서버 상품 가격으로 pending 주문. orderId/amount/currency/PG 준비정보 반환 |
| POST `/api/payments/confirm` | orderId, PG 인증 식별자 | 소유권·주문 금액·통화·PG 결제 상태를 서버 조회/승인. 트랜잭션으로 paid 기록 후 생성 작업 1개 등록 |
| POST `/api/payments/webhook` | 공급자 이벤트 | 공급자 검증, 이벤트 ID 중복 제거, 승인/취소/환불 상태 동기화 |
| GET `/api/orders/:id` | JWT | 자기 주문과 generationStatus(`queued/processing/ready/failed`) 및 readingId 반환 |
| GET `/api/readings/:id` | JWT | 자기 소유+paid 확인 후 상세 JSON. 환불/미결제/타인 요청은 거절 |

PG는 기존 기획의 NICE와 카카오페이 직접 연동 중 계약 후 확정해 주세요. 카카오 로그인 사용이 카카오페이 가맹을 의미하지 않습니다. 카카오페이 실결제는 사업자용 API/가맹점 절차가 필요하며 테스트 결제는 별도입니다. [카카오페이 공식 문서](https://developers.kakaopay.com/docs/payment/online/common).

주문/입력/분석 스냅샷을 하나로 연결하고, 결제 리다이렉트 query나 클라이언트 paid=true를 승인 근거로 사용하지 마세요. 중복 클릭·웹훅·승인 재전송에도 1회만 승인/생성합니다. 생성 실패 시 결제를 반복 청구하지 않고 서버 작업만 재시도합니다. 환불 후에는 기존 결과 접근도 회수합니다.

상세 AI 해설은 검증된 사주·한자·81수리 계산 결과만 입력으로 사용합니다. LLM에게 획수·사주 원국을 추정시키지 않습니다. 원획 출처/카탈로그 버전, SAZU 응답 버전/샘플 여부, 프롬프트/모델 버전을 저장합니다. 샘플 응답을 실제 유료 결과로 제공하지 마세요. 용신/자원오행 보완은 검증된 별도 근거가 있을 때만 생성하고, 오행 개수만으로 단정하지 않습니다.

현재 상세 화면이 읽는 `readings.content`:

```json
{
  "title": "분석 대상의 상세 풀이 제목",
  "summary": "검증된 데이터 기반 요약",
  "sections": [{ "heading": "해설 항목 제목", "body": "텍스트 해설" }]
}
```

HTML은 받지 않고 텍스트로 렌더링합니다. 현재 FE는 Supabase RLS를 통해 직접 읽습니다. BE 조회 API로 일원화할 경우 이 구조를 유지하고 FE의 내 풀이함 조회 부분을 교체해 주세요. 상태 조회·생성 중 표시도 그때 연결합니다.

## 8. 오류와 인수 조건

BE 오류는 `{success:false,error:{code,message}}` 형태를 권장합니다. FE BFF는 한국어 오류로 변환합니다. 외부 응답/키/토큰/이름/출생정보를 오류 로그에 출력하지 마세요. 개인 분석 응답은 `Cache-Control: private, no-store`입니다.

인수 시 확인할 항목:

- 비회원 이름·한자·사주 미리보기, 한자 없는 음/동음이자/획수 출처, 원획과 사전 총획 구분.
- 카카오 로그인 성공/취소/만료 후 입력 유지, 이메일 없는 카카오 계정, 로그아웃, 재로그인 후 내 결과.
- 원형이정 19/18/17/27(김서준 8/10/9), 81 경계값, 미등록 ID/음 불일치/조작 획수 거절.
- SAZU 샘플 표시, 시각 미상, 제공되지 않은 선택 모듈, 타임아웃/429/입력 변경 후 결과 초기화.
- 타인 request/order/reading ID 접근 차단, 요청 ID 중복·변조, 운영 호출 제한과 원가 제한.
- 결제 금액 변조, 승인 중복, 웹훅 재전송/순서 역전, 결제 성공·분석 실패, 환불 후 접근 회수.
- 검증되지 않은 한자/원획 데이터와 SAZU 샘플로 실제 결제를 진행하지 않음.

현재 자동 테스트는 외부 응답을 대체한 계약·단위 테스트와 PGlite PostgreSQL RLS 테스트입니다. 실제 Supabase·OAuth·SAZU·PG 검증을 대신하지 않습니다.

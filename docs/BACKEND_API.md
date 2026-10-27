# 백엔드 → 프론트 연동 명세

작성: 2026-10-27. 기준 저장소: `SZ_PROJECT_BE`.
현재 백엔드 코드의 계약이며 프론트의 기존 자체 API와 자동으로 호환되지 않습니다.

## 담당 구분과 문서

- BE: 외부 API 키, SAZU 호출, 입력 검증, 결제 승인, DB, 성명학 계산, AI 호출.
- FE: 입력/한자 선택 화면, 로딩·오류·결과 표시, 백엔드 API 연결.
- `ai.md`, `code_artifact.md`: 두 저장소에 동일한 원본이 이미 존재합니다.
- FE에 있는 `code_artifact (1).md`, `81.md`는 성명학 참고 자료이며 이번 전달 작업에서 변경하지 않았습니다.
- 공식 SAZU 문서: https://www.sazu.app/manse-api/docs#overview

## 연결

개발 BE 주소는 `http://127.0.0.1:3017`입니다.
브라우저 → FE의 동일 출처 서버 프록시 → BE의 `/api/sazu` → SAZU 순으로 연결합니다.

현재 BE는 다른 Origin을 거절하고 CORS/OPTIONS를 제공하지 않습니다. FE 서버 프록시는 원 요청의 Origin·Cookie·Authorization을 그대로 전달하지 말고 `Content-Type: application/json`으로 새 요청을 생성하세요. 브라우저에서 BE 포트로 직접 호출하면 연결되지 않습니다. 운영 인증은 아직 구현 전입니다.

SAZU 키는 **BE 환경변수 `SAZU_API_KEY`에만** 설정합니다. FE에 키를 복사하거나 SAZU를 중복 호출하지 않습니다.
FE README의 자체 SAZU 호출 방식은 분리 전 구현이므로 FE 프록시와 응답 어댑터를 아래 계약에 맞춰 수정해야 합니다. 해당 FE 코드 변경은 아직 하지 않았습니다.

## POST /api/sazu

Content-Type: `application/json`. 본문 최대 4,096바이트. 아래 필드는 모두 필수이며 추가 필드는 거절합니다.

```json
{
  "birthYear": 1998,
  "birthMonth": 5,
  "birthDay": 19,
  "birthHour": 10,
  "birthMinute": 0,
  "isFemale": false,
  "isLunar": false,
  "isLeapMonth": false,
  "birthCity": "서울",
  "trueSolarTime": false
}
```

| 필드 | 규칙 |
| --- | --- |
| birthYear | 정수 1900~2100. 실제 미래 출생일은 거절 |
| birthMonth | 정수 1~12 |
| birthDay | 정수 1~31. 양력 실제 날짜 검증, 음력 최대 30일 |
| birthHour | 정수 0~23 또는 시간 미상 null |
| birthMinute | 정수 0~59. 시간 미상일 때 **0** (null 불가) |
| isFemale | boolean. 성별 명시 |
| isLunar | boolean. 음력이면 true |
| isLeapMonth | boolean. 양력이면 반드시 false |
| birthCity | 공백 제거 후 1~40자. 도시 지원 여부는 공급자가 검증 |
| trueSolarTime | boolean. 기본 선택 false, 사용자 선택값 전송 |

이름·한자·획수·결제 완료 플래그는 이 API에 보내지 않습니다.
음력은 SAZU 변환 API로 유효성과 미래 날짜를 검증한 뒤 원래 음력 정보로 분석하므로 외부 호출이 2회입니다.

## 성공 응답

HTTP 200. `Cache-Control: no-store, private`.

```ts
type Pillar = {
  full: string;
  sky?: string;
  earth?: string;
  skyElement?: string;
  earthElement?: string;
  sippiSeong?: string;
  twelveStage?: string;
};

type SuccessResponse = {
  success: true;
  data: {
    source: "SAZU";
    sandbox: boolean;
    modules: {
      fourPillars: { year: Pillar; month: Pillar; day: Pillar; hour?: Pillar | null };
      elements?: Record<string, { name: string; total: { count: number } }>;
      sinStrength?: { strength: string; analysis?: string };
      decadeFortune?: { direction: string; list: { startAge: number; full: string }[] };
    };
  };
};
```

- `data.sandbox === true`이면 고정 샘플이며 개인 분석이 아니라는 안내가 필요합니다. **FE 기존 meta.sample과 다릅니다.**
- 시주가 null/누락이면 미상으로 처리하고 임의 값을 채우지 않습니다.
- 오행/신강약/대운은 선택 필드입니다. 누락을 0이나 빈 분석으로 단정하지 않습니다.
- 문장 해설·신살·용신·공급자 원문 전체는 현재 응답에 포함하지 않습니다. AI 해설은 후속 BE 기능입니다.

## 실패 응답

```ts
type FailureResponse = {
  success: false;
  error: { code: string; message: string };
};
```

| HTTP | error.code | FE 처리 |
| --- | --- | --- |
| 400 | INVALID_JSON / INVALID_INPUT / INVALID_DATE | 입력 수정 안내 |
| 400 | SAMPLE_PROFILE_REQUIRED | 공식 샘플 입력 안내 |
| 403 | FORBIDDEN_ORIGIN | FE 서버 프록시 연결 확인 |
| 413 | BODY_TOO_LARGE | 요청 크기 확인 |
| 415 | INVALID_CONTENT_TYPE | JSON 전송 확인 |
| 429 | RATE_LIMITED | 잠시 후 사용자가 재시도하도록 안내 |
| 503 | NOT_CONFIGURED / SERVICE_UNAVAILABLE | 서비스 이용 불가 안내 |
| 503 | PAYMENT_NOT_READY | 운영 서비스 준비 중 안내 |
| 504 | UPSTREAM_TIMEOUT | 연결 실패/시간 초과 안내 |
| 502 | INVALID_RESPONSE / UPSTREAM_ERROR | 분석 조회 실패 안내 |
| 500 | INTERNAL_ERROR | 일반 오류 안내 |

사용자에게는 error.message를 표시합니다. 중복 제출과 무조건 자동 재시도를 피하고 입력 정보가 바뀌면 기존 결과를 초기화하세요.

## 구현·검증 상태

- BE 구현: 요청 검증, SAZU 공식 SDK readings.manse(), 응답 검증, 오류 변환.
- 서버 테스트는 외부 응답을 대체한 계약 테스트입니다. 실제 발급 키의 응답 성공은 미검증입니다.
- 결제·주문 소유권 검증 구현 전에는 **production에서 항상 503 PAYMENT_NOT_READY**입니다. 개발 환경에서만 연결을 시험할 수 있습니다.
- 한자 DB API, 성명학 API, NICE 결제, 인증, 주문 저장, AI 해설은 미구현입니다.

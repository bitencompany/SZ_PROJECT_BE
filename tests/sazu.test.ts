import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { birthSchema, type BirthInput } from "../src/lib/sazu/schema";
import { analyzeBirth } from "../src/lib/sazu/client";
import { POST } from "../src/app/api/sazu/route";

const birth: BirthInput = {
  birthYear: 1998,
  birthMonth: 5,
  birthDay: 19,
  birthHour: 10,
  birthMinute: 0,
  isFemale: false,
  isLunar: false,
  isLeapMonth: false,
  birthCity: "서울",
  trueSolarTime: false,
};
// 계약 검증용 합성 데이터입니다. 실제 사주 계산 결과나 사용자에게 표시할 샘플이 아닙니다.
const modules = {
  fourPillars: {
    year: { full: "연주" },
    month: { full: "월주" },
    day: { full: "일주" },
    hour: null,
  },
  elements: { wood: { name: "목", total: { count: 2 } } },
  sinStrength: { strength: "검증용", analysis: "계약 검증용 설명" },
  decadeFortune: { direction: "순행", list: [{ startAge: 3, full: "대운" }] },
};
const mockFetch = vi.fn<typeof fetch>();
function successResponse(data: unknown): Response {
  return Response.json({ success: true, data });
}
function request(
  body: unknown = birth,
  extraHeaders: Record<string, string> = {},
): Request {
  return new Request("http://localhost:3000/api/sazu", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...extraHeaders },
    body: JSON.stringify(body),
  });
}

beforeEach((): void => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("SAZU_API_KEY", "sazu_free_TEST_ONLY");
  vi.stubGlobal("fetch", mockFetch);
});
afterEach((): void => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  mockFetch.mockReset();
});

describe("출생 정보 검증", (): void => {
  it("양력의 존재하지 않는 날짜와 미래 날짜를 거절한다", (): void => {
    expect(
      birthSchema.safeParse({ ...birth, birthMonth: 2, birthDay: 30 }).success,
    ).toBe(false);
    expect(birthSchema.safeParse({ ...birth, birthYear: 2100 }).success).toBe(
      false,
    );
    expect(
      birthSchema.safeParse({
        ...birth,
        birthYear: 2000,
        birthMonth: 2,
        birthDay: 29,
      }).success,
    ).toBe(true);
  });
  it("음력은 양력 날짜 규칙으로 잘못 거절하지 않는다", (): void => {
    expect(
      birthSchema.safeParse({
        ...birth,
        isLunar: true,
        birthMonth: 2,
        birthDay: 30,
      }).success,
    ).toBe(true);
    expect(
      birthSchema.safeParse({ ...birth, isLunar: true, birthDay: 31 }).success,
    ).toBe(false);
    expect(birthSchema.safeParse({ ...birth, isLeapMonth: true }).success).toBe(
      false,
    );
  });
  it("시간 미상과 잘못된 타입, 추가 필드를 검증한다", (): void => {
    expect(birthSchema.safeParse({ ...birth, birthHour: null }).success).toBe(
      true,
    );
    expect(
      birthSchema.safeParse({ ...birth, birthHour: null, birthMinute: 15 })
        .success,
    ).toBe(false);
    expect(birthSchema.safeParse({ ...birth, isFemale: "false" }).success).toBe(
      false,
    );
    expect(birthSchema.safeParse({ ...birth, paid: true }).success).toBe(false);
  });
});

describe("SAZU 서버 연동", (): void => {
  it("공식 v2 경로와 인증 헤더를 사용하고 반환 필드를 제한한다", async (): Promise<void> => {
    mockFetch.mockResolvedValue(
      successResponse({
        modules: { ...modules, privateExtra: "must-not-leak" },
      }),
    );
    const result = await analyzeBirth({ ...birth, birthHour: null });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.sazu.app/v2/sazu/manse");
    expect(new Headers(options?.headers).get("x-api-key")).toBe(
      "sazu_free_TEST_ONLY",
    );
    expect(JSON.parse(options?.body as string)).toMatchObject({
      birthHour: null,
      isLunar: false,
      locale: "ko",
    });
    expect(result).toEqual({ modules, source: "SAZU", sandbox: true });
    expect(JSON.stringify(result)).not.toContain("TEST_ONLY");
  });
  it("키가 없으면 외부 요청을 보내지 않는다", async (): Promise<void> => {
    vi.stubEnv("SAZU_API_KEY", "");
    await expect(analyzeBirth(birth)).rejects.toMatchObject({
      status: 503,
      code: "NOT_CONFIGURED",
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it("잘못된 성공 응답을 거절한다", async (): Promise<void> => {
    mockFetch.mockResolvedValue(successResponse({ modules: {} }));
    await expect(analyzeBirth(birth)).rejects.toMatchObject({
      status: 502,
      code: "INVALID_RESPONSE",
    });
  });
  it.each([
    { status: 401, code: "INVALID_API_KEY", expected: 503 },
    { status: 402, code: "QUOTA_EXHAUSTED", expected: 503 },
    { status: 429, code: "RATE_LIMITED", expected: 429 },
    { status: 400, code: "SAMPLE_PROFILE_REQUIRED", expected: 400 },
    { status: 500, code: "INTERNAL", expected: 502 },
  ])(
    "외부 $status 오류를 안전하게 변환하고 재호출하지 않는다",
    async ({ status, code, expected }): Promise<void> => {
      mockFetch.mockResolvedValue(
        Response.json(
          {
            success: false,
            error: {
              code,
              message: "sazu_free_TEST_ONLY private upstream text",
            },
          },
          { status },
        ),
      );
      const response: Response = await POST(request());
      expect(response.status).toBe(expected);
      expect(await response.text()).not.toContain("TEST_ONLY");
      expect(mockFetch).toHaveBeenCalledTimes(1);
    },
  );
  it("네트워크 실패를 한국어 오류로 응답한다", async (): Promise<void> => {
    mockFetch.mockRejectedValue(new TypeError("sensitive network detail"));
    const response: Response = await POST(request());
    expect(response.status).toBe(504);
    expect(await response.text()).not.toContain("sensitive");
  });
  it("음력 윤달은 변환 API로 검증하고 원래 출생 정보를 전달한다", async (): Promise<void> => {
    mockFetch
      .mockResolvedValueOnce(
        successResponse({ result: { year: 1998, month: 7, day: 8 } }),
      )
      .mockResolvedValueOnce(successResponse({ modules }));
    await analyzeBirth({
      ...birth,
      birthDay: 15,
      isLunar: true,
      isLeapMonth: true,
    });
    expect(mockFetch.mock.calls[0][0]).toBe(
      "https://api.sazu.app/v2/calendar/convert",
    );
    expect(
      JSON.parse(mockFetch.mock.calls[0][1]?.body as string),
    ).toMatchObject({ direction: "toSolar", isLeapMonth: true });
    expect(
      JSON.parse(mockFetch.mock.calls[1][1]?.body as string),
    ).toMatchObject({
      birthMonth: 5,
      birthDay: 15,
      isLunar: true,
      isLeapMonth: true,
    });
  });
  it("양력으로 변환한 음력 날짜가 미래이면 분석하지 않는다", async (): Promise<void> => {
    mockFetch.mockResolvedValue(
      successResponse({ result: { year: 2100, month: 1, day: 1 } }),
    );
    await expect(
      analyzeBirth({ ...birth, isLunar: true }),
    ).rejects.toMatchObject({ status: 400, code: "INVALID_DATE" });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/sazu 경계", (): void => {
  it("개인 분석 응답은 캐시하지 않는다", async (): Promise<void> => {
    mockFetch.mockResolvedValue(successResponse({ modules }));
    const response: Response = await POST(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store, private");
  });
  it("다른 출처와 잘못된 입력은 외부 호출 전에 차단한다", async (): Promise<void> => {
    expect(
      (await POST(request(birth, { Origin: "https://other.example" }))).status,
    ).toBe(403);
    expect((await POST(request({ ...birth, birthHour: 24 }))).status).toBe(400);
    expect(
      (await POST(request(birth, { "Content-Type": "text/plain" }))).status,
    ).toBe(415);
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it("깨진 JSON과 크기 초과 요청을 처리한다", async (): Promise<void> => {
    const invalid = new Request("http://localhost:3000/api/sazu", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });
    expect((await POST(invalid)).status).toBe(400);
    expect((await POST(request({ large: "가".repeat(2000) }))).status).toBe(
      413,
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it("운영 환경에서는 결제 검증 구현 전 API 호출을 차단한다", async (): Promise<void> => {
    vi.stubEnv("NODE_ENV", "production");
    expect((await POST(request())).status).toBe(503);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

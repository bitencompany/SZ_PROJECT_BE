import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { SazuApiError, SazuClient } from "@sazuapp/client";
import { z } from "zod";
import { analyzeBirth, AnalysisError } from "../src/lib/sazu/client";
import { birthSchema, modulesSchema } from "../src/lib/sazu/schema";
import { previewFields, SAZU_VERSION } from "../src/lib/backend/preview";

// Never send the BFF secret to a user-supplied host or follow redirects.
const origin = "http://127.0.0.1:3017";
const session = randomUUID();
const sampleSchema = z.object({
  samples: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        input: z
          .object({
            ...birthSchema.shape,
            birthMinute: birthSchema.shape.birthMinute.default(0),
            isLeapMonth: birthSchema.shape.isLeapMonth.default(false),
            trueSolarTime: birthSchema.shape.trueSolarTime.default(false),
          })
          .pipe(birthSchema),
      }),
    )
    .min(1),
  referenceDate: z.string(),
});
const resultSchema = z.object({
  success: z.literal(true),
  data: z.object({
    source: z.literal("SAZU"),
    sandbox: z.literal(true),
    modules: modulesSchema,
    previewId: z.uuid(),
    expiresAt: z.iso.datetime(),
    providerVersion: z.string(),
  }),
});
async function request(birth: unknown, authenticated = true) {
  return fetch(`${origin}/api/sazu/preview`, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(30000),
    headers: {
      "content-type": "application/json",
      "x-client-ip": "127.0.0.1",
      "x-anonymous-id": session,
      ...(authenticated
        ? { "x-bff-secret": process.env.BFF_SHARED_SECRET! }
        : {}),
    },
    body: JSON.stringify({ birth }),
  });
}

try {
  const apiKey = process.env.SAZU_API_KEY?.trim();
  assert(apiKey, "SAZU_API_KEY를 .env.local에 설정해 주세요.");
  assert(
    apiKey.startsWith("sazu_free_"),
    "무료 키 전용 검증입니다. 유료 키로는 실행하지 않습니다.",
  );
  assert(process.env.BFF_SHARED_SECRET, "BFF_SHARED_SECRET가 필요합니다.");
  assert(
    process.env.PREVIEW_ENABLED === "true",
    "로컬 PREVIEW_ENABLED=true 설정 후 개발 서버를 재시작해 주세요.",
  );
  const client = new SazuClient({
    apiKey,
    timeoutMs: 15000,
    maxRetries: 0,
    requestsPerMinute: 10,
  });
  const samples = sampleSchema.parse(await client.readings.samples());
  // Exercise one ordinary solar profile first; lunar/unknown-time are separate checks.
  const sample = samples.samples.find(
    (s) => !s.input.isLunar && s.input.birthHour !== null,
  );
  assert(sample, "공급자의 양력·시간 명시 샘플을 찾지 못했습니다.");
  const birth = sample.input;
  const direct = previewFields(await analyzeBirth(birth), birth);
  assert.equal(direct.sandbox, true);
  const first = await request(birth);
  assert.equal(
    first.status,
    200,
    "미리보기 HTTP 성공 여부를 확인하세요. 서버 환경변수/DB 설정이 필요합니다.",
  );
  assert.equal(first.headers.get("cache-control"), "no-store, private");
  const result = resultSchema.parse(await first.json()).data;
  assert.deepEqual(result.modules, direct.modules);
  assert.equal(result.providerVersion, SAZU_VERSION);
  assert(
    Date.parse(result.expiresAt) > Date.now(),
    "미리보기가 만료되었습니다.",
  );
  assert(
    Date.parse(result.expiresAt) <= Date.now() + 31 * 60000,
    "미리보기 만료 시간이 잘못되었습니다.",
  );
  const second = await request(birth);
  assert.equal(second.status, 200);
  assert.deepEqual(resultSchema.parse(await second.json()).data, result);
  assert.equal((await request(birth, false)).status, 403);
  assert.equal((await request({ ...birth, birthHour: 24 })).status, 400);
  const report = {
    checkedAt: new Date().toISOString(),
    origin,
    status: "passed",
    sample: {
      id: sample.id,
      label: sample.label,
      birth,
      referenceDate: samples.referenceDate,
    },
    result,
    checks: [
      "공식 무료 샘플 목록 조회",
      "SAZU 실제 분석 응답 스키마 검증",
      "BFF 미리보기 HTTP 200 및 직접 응답 일치",
      "sandbox=true",
      "DB 캐시 재사용: 동일 previewId/만료/결과",
      "BFF 누락 403",
      "잘못된 출생시간 400",
    ],
    limitations: [
      "공식 양력 샘플 1건 검증이며 실제 개인 분석이 아닙니다.",
      "음력·윤달·시간 미상 실호출은 별도 검증이 필요합니다.",
      "결제 및 유료 키 전환은 수행하지 않습니다.",
    ],
  };
  await mkdir(".local/verification", { recursive: true });
  await writeFile(
    ".local/verification/sazu-http.json",
    JSON.stringify(report, null, 2) + "\n",
    { mode: 0o600 },
  );
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  // Never print SDK response bodies, keys, or raw network errors.
  const message =
    error instanceof SazuApiError
      ? `SAZU HTTP ${error.status} (인증/사용량은 대시보드 확인)`
      : error instanceof AnalysisError
        ? error.code
        : error instanceof assert.AssertionError
          ? error.message
          : error instanceof z.ZodError
            ? "SAZU 응답이 현재 계약과 다릅니다. 스키마 확인이 필요합니다."
            : "네트워크/서버 오류: 로컬 서버와 연결 상태를 확인하세요.";
  console.error("SAZU 무료 연동 검증 실패:", message);
  process.exitCode = 1;
}

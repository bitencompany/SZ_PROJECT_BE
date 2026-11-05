import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { generateKeyPair, SignJWT, createLocalJWKSet, exportJWK } from "jose";
vi.mock("server-only", () => ({}));
import type { Database, Queryable } from "../src/lib/backend/db";
import {
  analyzeName,
  findHanja,
  normalizeSuri,
  soundElement,
  relationship,
  catalogImportSchema,
} from "../src/lib/backend/catalog";
import { nameResponseSchema } from "../src/lib/name-contract";
import { readingRequestInput, previewInput } from "../src/lib/backend/inputs";
import {
  saveRequest,
  getRequest,
  deleteRequest,
} from "../src/lib/backend/requests";
import { verifyUser, visitor } from "../src/lib/backend/security";
import { consume } from "../src/lib/backend/limits";
import {
  createPreview,
  matchingPreview,
  previewFields,
} from "../src/lib/backend/preview";
import {
  createOrder,
  confirmPayment,
  applyPayment,
  refundPayment,
  paymentProvider,
  orderStatus,
  type PaymentProvider,
  type VerifiedPayment,
} from "../src/lib/backend/payments";
import {
  runGeneration,
  retryGeneration,
  generateText,
} from "../src/lib/backend/generation";
import { getReading, listReadings, cleanup } from "../src/lib/backend/readings";
import { body, endpoint } from "../src/lib/backend/http";
import type { BirthInput } from "../src/lib/sazu/schema";

const pg = new PGlite();
let active: Queryable | undefined;
const direct: Queryable = {
  async query<T>(sql: string, params: unknown[] = []) {
    return (await pg.query<T>(sql, params)).rows;
  },
};
// PGlite는 한 연결입니다. 중첩 서비스는 같은 transaction 실행기에 연결합니다.
const db: Database = {
  async query<T>(sql: string, params: unknown[] = []) {
    return (active ?? direct).query<T>(sql, params);
  },
  async transaction<T>(fn: (tx: Queryable) => Promise<T>) {
    if (active) return fn(active);
    return pg.transaction(async (t) => {
      active = {
        async query<R>(sql: string, params: unknown[] = []) {
          return (await t.query<R>(sql, params)).rows;
        },
      };
      try {
        return await fn(active);
      } finally {
        active = undefined;
      }
    });
  },
};
const owner = "10000000-0000-4000-8000-000000000001",
  stranger = "10000000-0000-4000-8000-000000000002";
const name = { name: "김서준", hanjaIds: ["김-金", "서-書", "준-俊"] };
const birth: BirthInput = {
  birthYear: 1998,
  birthMonth: 5,
  birthDay: 19,
  birthHour: null,
  birthMinute: 0,
  isFemale: false,
  isLunar: false,
  isLeapMonth: false,
  birthCity: "서울",
  trueSolarTime: false,
};
const modules = {
  fourPillars: {
    year: { full: "합성연주" },
    month: { full: "합성월주" },
    day: { full: "합성일주" },
    hour: null,
  },
  elements: { wood: { name: "목", total: { count: 2 } } },
};
const content = {
  title: "계약 테스트",
  summary: "합성 데이터 설명",
  sections: [{ heading: "검증", body: "실제 풀이가 아닙니다." }],
};
const entries = name.hanjaIds.map((id, i) => ({
  id,
  reading: name.name[i],
  character: ["金", "書", "俊"][i],
  meaning: "테스트",
  ...(i === 0 ? { searchAliases: ["합성 본관 김씨"], meanings: ["테스트", "보조 뜻"] } : {}),
  strokes: [8, 10, 9][i],
  dictionaryStrokes: [8, 10, 9][i],
  element: null,
  isBulyong: null,
  strokeReview: "reference-checked",
  strokeSources: [
    {
      title: "합성 원획",
      url: "https://example.test/original",
      basis: "naming-original",
    },
    {
      title: "합성 사전",
      url: "https://example.test/dictionary",
      basis: "dictionary",
    },
  ],
}));
const evidence = {
  registrationSource: "https://example.test/registration",
  license: "테스트 전용",
  reviewedAt: "2026-10-30",
  reviewer: "test",
  originalStrokeRule: "합성",
  radicalAdjustment: "없음",
  variantOf: null,
  elementEvidence: null,
  bulyongEvidence: null,
};
const provider: PaymentProvider = {
  code: "test-only",
  prepare: vi.fn(async () => ({ test: true })),
  confirm: vi.fn<PaymentProvider["confirm"]>(async (order) => ({
    provider: "test-only",
    eventId: `paid:${order.id}`,
    orderId: order.id,
    paymentId: `pg:${order.id}`,
    amount: order.amount,
    currency: "KRW",
    state: "paid",
  })),
  verifyWebhook: vi.fn(),
  refund: vi.fn<PaymentProvider["refund"]>(async (order) => ({
    provider: "test-only",
    eventId: `refund:${order.id}`,
    orderId: order.id,
    paymentId: `pg:${order.id}`,
    amount: order.amount,
    currency: "KRW",
    state: "refunded",
  })),
};
async function save(extra = {}) {
  const requestId = randomUUID();
  await saveRequest(
    db,
    owner,
    readingRequestInput.parse({
      requestId,
      ...name,
      birth: null,
      consentToSave: true,
      ...extra,
    }),
  );
  return requestId;
}
async function order(extra = {}) {
  const requestId = await save(extra);
  return (
    await createOrder(
      db,
      owner,
      { requestId, productCode: "reading", idempotencyKey: randomUUID() },
      provider,
    )
  ).data.orderId;
}
async function paid() {
  const id = await order();
  await confirmPayment(
    db,
    owner,
    { orderId: id, paymentToken: "test" },
    provider,
  );
  return id;
}
function event(
  id: string,
  state: VerifiedPayment["state"] = "paid",
): VerifiedPayment {
  return {
    provider: "test-only",
    eventId: `${state}:${id}`,
    orderId: id,
    paymentId: `pg:${id}`,
    amount: 1000,
    currency: "KRW",
    state,
  };
}
beforeAll(async () => {
  await pg.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`,
  );
  for (const file of ["202610300001_readings.sql", "202610300002_backend.sql"])
    await pg.exec(
      await readFile(
        new URL(`../supabase/migrations/${file}`, import.meta.url),
        "utf8",
      ),
    );
}, 30_000);
beforeEach(async () => {
  vi.stubEnv("INPUT_HASH_SECRET", "test-only-hash-secret");
  vi.stubEnv("BFF_SHARED_SECRET", "test-bff-secret");
  vi.stubEnv("PREVIEW_ENABLED", "true");
  vi.stubEnv("OPENAI_API_KEY", "test-only-key");
  vi.stubEnv("OPENAI_MODEL", "test-only-model");
  await pg.exec(
    `truncate auth.users,public.reading_requests,public.orders,public.readings,private.catalogs,private.products,private.previews,private.usage_limits cascade;`,
  );
  await db.query("insert into auth.users(id) values($1),($2)", [
    owner,
    stranger,
  ]);
  await db.query(
    "insert into private.catalogs(version,status,metadata) values('test-only','verified','{}')",
  );
  await db.query(
    "insert into private.active_catalog(version) values('test-only')",
  );
  for (const entry of entries)
    await db.query(
      "insert into private.catalog_entries(version,id,reading,entry,evidence) values('test-only',$1,$2,$3::jsonb,$4::jsonb)",
      [
        entry.id,
        entry.reading,
        JSON.stringify(entry),
        JSON.stringify(evidence),
      ],
    );
  await db.query(
    "insert into private.products(code,title,amount,currency,active) values('reading','테스트',1000,'KRW',true)",
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
afterAll(async () => {
  await pg.close();
});

describe("한자와 계산 계약", () => {
  it("泰는 원자료 9획 대신 실제 필획 10획으로 계산하고 미확인 필획은 거절한다", async () => {
    for (const [id, dictionaryStrokes] of [["tae", 10], ["tae-missing", null]] as const) {
      await db.query("insert into private.catalog_entries(version,id,reading,entry,evidence) values('test-only',$1,'태',$2::jsonb,$3::jsonb)", [
        id, JSON.stringify({ ...entries[0], id, character: "泰", reading: "태", strokes: 9, dictionaryStrokes }), JSON.stringify(evidence),
      ]);
    }
    const result = await analyzeName(db, { name: "태서준", hanjaIds: ["tae", ...name.hanjaIds.slice(1)] });
    expect(result.data.grids.map((grid) => grid.total)).toEqual([19, 20, 19, 29]);
    await expect(analyzeName(db, { name: "태서준", hanjaIds: ["tae-missing", ...name.hanjaIds.slice(1)] })).rejects.toMatchObject({ code: "WRITTEN_STROKES_UNAVAILABLE" });
  });
  it("원형이정 19/18/17/27, FE 응답 스키마, 방향을 보존한다", async () => {
    const result = await analyzeName(db, name);
    expect(result.data.grids.map((g) => g.total)).toEqual([19, 18, 17, 27]);
    expect(nameResponseSchema.safeParse(result).success).toBe(true);
    expect([81, 82, 161].map(normalizeSuri)).toEqual([81, 2, 81]);
    expect(soundElement("까")).toBeNull();
    expect(relationship("목", "화")).toBe("상생");
    expect(relationship("화", "목")).toBe("역방향 상생");
  });
  it("미등록 ID와 음 불일치를 거절하고 없는 음은 빈 배열이다", async () => {
    await expect(
      analyzeName(db, {
        ...name,
        hanjaIds: ["없는값", ...name.hanjaIds.slice(1)],
      }),
    ).rejects.toMatchObject({ code: "HANJA_MISMATCH" });
    await expect(
      analyzeName(db, { ...name, name: "이서준" }),
    ).rejects.toMatchObject({ code: "HANJA_MISMATCH" });
    expect((await findHanja(db, "태", "")).data).toEqual([]);
    expect((await findHanja(db, "김", "金")).data).toHaveLength(1);
    expect((await findHanja(db, "김", "테스트 김")).data).toHaveLength(1);
    expect((await findHanja(db, "김", "보조뜻김")).data).toHaveLength(1);
    expect((await findHanja(db, "서", "보조뜻김")).data).toHaveLength(0);
    for (const query of ["합성 본관 김", "합성본관김", "합성 본관 김씨"]) {
      const result = await findHanja(db, "김", query);
      expect(result.data.map((item) => item.character)).toEqual(["金"]);
      expect(result.data[0].searchAliases).toEqual(["합성 본관 김씨"]);
    }
    expect((await findHanja(db, "서", "합성본관김")).data).toEqual([]);
    expect((await findHanja(db, "김", "없는 뜻")).data).toHaveLength(0);
  });
  it("검수 표시만으로는 출처 없는 원획을 import할 수 없다", () => {
    expect(
      catalogImportSchema.safeParse({
        catalog: { status: "verified", version: "x" },
        metadata: {
          scope: "full-personal-name-catalog",
          sourceVersion: "test",
          license: "test",
          reviewedAt: "2026-10-30",
          rules: "test",
        },
        entries: [{ entry: { ...entries[0], strokeSources: [] }, evidence }],
      }).success,
    ).toBe(false);
  });
});
describe("입력/소유권/보관", () => {
  it("동일 requestId 재시도 성공, 변경 409, 다른 계정 404", async () => {
    const id = await save();
    const input = readingRequestInput.parse({
      requestId: id,
      ...name,
      birth: null,
      consentToSave: true,
    });
    expect((await saveRequest(db, owner, input)).data.paymentAvailable).toBe(
      false,
    );
    await expect(
      saveRequest(db, owner, { ...input, name: "김서진" }),
    ).rejects.toMatchObject({ code: "REQUEST_CONFLICT" });
    await expect(saveRequest(db, stranger, input)).rejects.toMatchObject({
      status: 404,
    });
    await expect(getRequest(db, stranger, id)).rejects.toMatchObject({
      status: 404,
    });
    await deleteRequest(db, owner, id);
    await expect(getRequest(db, owner, id)).rejects.toMatchObject({
      status: 404,
    });
  });
  it("클라이언트 획수/userId/동의 누락 및 잘못된 날짜 거절", () => {
    const input = {
      requestId: randomUUID(),
      ...name,
      birth: null,
      consentToSave: true,
    };
    expect(
      readingRequestInput.safeParse({ ...input, userId: owner }).success,
    ).toBe(false);
    expect(
      readingRequestInput.safeParse({ ...input, strokes: [8, 10, 9] }).success,
    ).toBe(false);
    expect(
      readingRequestInput.safeParse({ ...input, consentToSave: false }).success,
    ).toBe(false);
    expect(
      readingRequestInput.safeParse({
        ...input,
        birth: {
          birthDate: "2000-02-30",
          birthTime: null,
          gender: "male",
          birthCity: "서울",
          consent: true,
        },
      }).success,
    ).toBe(false);
  });
  it("DB에서도 입력 변경/직접 authenticated insert를 막는다", async () => {
    const id = await save();
    await expect(
      db.query(
        "update public.reading_requests set catalog_status='verified' where id=$1",
        [id],
      ),
    ).rejects.toThrow("IMMUTABLE_RECORD");
    await pg.exec(
      `set role authenticated;select set_config('request.jwt.claim.sub','${stranger}',false)`,
    );
    try {
      expect(
        (await db.query("select * from public.reading_requests")).length,
      ).toBe(0);
      await expect(
        db.query(
          "insert into public.reading_requests(id,user_id,input,catalog_status,catalog_version,consent_version) values($1,$2,'{}','verified','fake','fake')",
          [randomUUID(), stranger],
        ),
      ).rejects.toThrow();
    } finally {
      await pg.exec("reset role");
    }
  });
  it("30일 지난 미구매 입력과 만료 preview를 정리한다", async () => {
    await db.query(
      "insert into public.reading_requests(id,user_id,input,catalog_status,catalog_version,consent_version,created_at) values($1,$2,'{}','preview','old','old',now()-interval '31 days')",
      [randomUUID(), owner],
    );
    expect((await cleanup(db)).data.requestsDeleted).toBe(1);
  });
});
describe("미리보기와 호출 비용", () => {
  it("문자열로 이중 직렬화된 캐시는 재사용하거나 연결하지 않고 정상 객체로 교체한다", async () => {
    const analyze = vi.fn(async () => ({
      source: "SAZU" as const,
      sandbox: true,
      modules,
    }));
    const first = await createPreview(db, birth, analyze);
    await db.query(
      "update private.previews set result=to_jsonb(result::text) where id=$1",
      [first.id],
    );
    expect(await matchingPreview(db, first.id, birth)).toBeUndefined();
    const repaired = await createPreview(db, birth, analyze);
    expect(repaired.id).not.toBe(first.id);
    expect(repaired.result.source).toBe("SAZU");
    expect(repaired.result.sandbox).toBe(true);
    expect(analyze).toHaveBeenCalledTimes(2);
    expect((await createPreview(db, birth, analyze)).id).toBe(repaired.id);
    expect(analyze).toHaveBeenCalledTimes(2);
  });
  it("시간 미상/선택 필드/무료 필드를 보존하고 동일 입력을 재사용한다", async () => {
    const analyze = vi.fn(async () => ({
      source: "SAZU" as const,
      sandbox: false,
      modules: { ...modules, sinStrength: { strength: "유료 해설" } },
    }));
    const a = await createPreview(db, birth, analyze),
      b = await createPreview(db, birth, analyze);
    expect(a.id).toBe(b.id);
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(a.result.modules).not.toHaveProperty("sinStrength");
    expect(a.result.modules.fourPillars.hour).toBeNull();
    expect(
      await matchingPreview(db, a.id, { ...birth, birthDay: 20 }),
    ).toBeUndefined();
    expect(
      previewFields(
        {
          source: "SAZU",
          sandbox: false,
          modules: { fourPillars: modules.fourPillars },
        },
        birth,
      ).modules,
    ).not.toHaveProperty("elements");
    expect(previewInput.safeParse({ birth, consent: false }).success).toBe(
      false,
    );
  });
  it("익명 헤더 위조와 지속형 한도 초과를 거절한다", async () => {
    expect(() =>
      visitor(
        new Request("https://be.test", {
          headers: {
            "x-client-ip": "127.0.0.1",
            "x-anonymous-id": randomUUID(),
          },
        }),
      ),
    ).toThrow();
    await consume(db, "quota-test", 1, 3600);
    await expect(consume(db, "quota-test", 1, 3600)).rejects.toMatchObject({
      status: 429,
    });
  });
});
describe("주문, 승인, 생성, 환불", () => {
  it("실결제는 설정값으로 활성화할 수 없다", () => {
    vi.stubEnv("PAYMENTS_ENABLED", "true");
    expect(() => paymentProvider()).toThrow(
      expect.objectContaining({ code: "PAYMENT_NOT_READY" }),
    );
  });
  it("서버 가격/스냅샷과 멱등 주문을 보장한다", async () => {
    const requestId = await save();
    const input = {
      requestId,
      productCode: "reading",
      idempotencyKey: randomUUID(),
    };
    const a = await createOrder(db, owner, input, provider),
      b = await createOrder(db, owner, input, provider);
    expect(a.data.orderId).toBe(b.data.orderId);
    expect(a.data.amount).toBe(1000);
    await expect(
      createOrder(db, owner, { ...input, productCode: "tampered" }, provider),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await expect(
      db.query(
        "update private.order_snapshots set snapshot='{}' where order_id=$1",
        [a.data.orderId],
      ),
    ).rejects.toThrow("IMMUTABLE_RECORD");
    await expect(deleteRequest(db, owner, requestId)).rejects.toMatchObject({
      code: "ORDER_LINKED_REQUEST",
    });
  });
  it("preview 카탈로그와 샘플 사주로 주문을 만들지 않는다", async () => {
    await db.query(
      "insert into private.catalogs(version,status,metadata) values('preview','preview','{}')",
    );
    await db.query("update private.active_catalog set version='preview'");
    await expect(order()).rejects.toMatchObject({ code: "UNVERIFIED_CATALOG" });
    await db.query("update private.active_catalog set version='test-only'");
    const p = await createPreview(db, birth, async () => ({
      source: "SAZU",
      sandbox: true,
      modules,
    }));
    await expect(
      order({
        previewId: p.id,
        birth: {
          birthDate: "1998-05-19",
          birthTime: null,
          gender: "male",
          birthCity: "서울",
          consent: true,
        },
      }),
    ).rejects.toMatchObject({ code: "SAMPLE_NOT_PAYABLE" });
  });
  it("타인 승인/금액 변조 거절, 중복 승인/웹훅은 작업 하나", async () => {
    const id = await order();
    await expect(
      confirmPayment(
        db,
        stranger,
        { orderId: id, paymentToken: "x" },
        provider,
      ),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      applyPayment(db, { ...event(id), amount: 1 }),
    ).rejects.toMatchObject({ code: "PAYMENT_MISMATCH" });
    await confirmPayment(
      db,
      owner,
      { orderId: id, paymentToken: "x" },
      provider,
    );
    await confirmPayment(
      db,
      owner,
      { orderId: id, paymentToken: "x" },
      provider,
    );
    await applyPayment(db, event(id));
    await applyPayment(db, { ...event(id), eventId: "another" });
    expect(provider.confirm).toHaveBeenCalledTimes(1);
    expect(
      await db.query("select * from private.generation_jobs"),
    ).toHaveLength(1);
  });
  it("결제 후 생성 실패는 재청구 없이 재시도하고 환불은 접근을 회수한다", async () => {
    const id = await paid();
    await runGeneration(db, async () => {
      throw new Error("secret detail");
    });
    expect((await orderStatus(db, owner, id)).data).toMatchObject({
      status: "paid",
      generationStatus: "queued",
    });
    expect(
      JSON.stringify(await db.query("select * from private.generation_jobs")),
    ).not.toContain("secret detail");
    await db.query("update private.generation_jobs set available_at=now()");
    await runGeneration(db, async () => ({
      content,
      model: "test-only-model",
    }));
    const status = (await orderStatus(db, owner, id)).data;
    expect(status.generationStatus).toBe("ready");
    expect((await getReading(db, owner, status.readingId!)).data).toMatchObject(
      { content },
    );
    await expect(
      getReading(db, stranger, status.readingId!),
    ).rejects.toMatchObject({ status: 404 });
    await refundPayment(db, id, provider);
    await applyPayment(db, { ...event(id), eventId: "late-paid" });
    expect((await orderStatus(db, owner, id)).data.status).toBe("refunded");
    await expect(
      getReading(db, owner, status.readingId!),
    ).rejects.toMatchObject({ status: 404 });
    expect((await listReadings(db, owner, 0)).data).toHaveLength(0);
    await pg.exec(
      `set role authenticated;select set_config('request.jwt.claim.sub','${owner}',false)`,
    );
    try {
      expect(await db.query("select * from public.readings")).toHaveLength(0);
    } finally {
      await pg.exec("reset role");
    }
  });
  it("취소가 승인보다 먼저 도착해도 접근을 부여하지 않는다", async () => {
    const id = await order();
    await applyPayment(db, event(id, "cancelled"));
    await applyPayment(db, event(id));
    expect((await orderStatus(db, owner, id)).data.status).toBe("cancelled");
    expect(
      await db.query("select * from private.generation_jobs"),
    ).toHaveLength(0);
  });
  it("생성 중 환불이 도착하면 결과를 저장하지 않는다", async () => {
    const id = await paid();
    await runGeneration(db, async () => {
      await applyPayment(db, event(id, "refunded"));
      return { content, model: "test-only-model" };
    });
    expect(await db.query("select * from public.readings")).toHaveLength(0);
  });
  it("3회 실패 후 명시적 재시도 및 마지막 lease 만료를 처리한다", async () => {
    const id = await paid();
    for (let i = 0; i < 3; i++) {
      await runGeneration(db, async () => {
        throw new Error();
      });
      await db.query("update private.generation_jobs set available_at=now()");
    }
    expect((await orderStatus(db, owner, id)).data.generationStatus).toBe(
      "failed",
    );
    await retryGeneration(db, owner, id);
    expect((await orderStatus(db, owner, id)).data.generationStatus).toBe(
      "queued",
    );
    await db.query(
      "update private.generation_jobs set status='processing',attempts=3,lease_until=now()-interval '1 minute'",
    );
    await runGeneration(db, async () => ({
      content,
      model: "test-only-model",
    }));
    expect((await orderStatus(db, owner, id)).data.generationStatus).toBe(
      "failed",
    );
  });
});
describe("JWT와 HTTP", () => {
  it("서명/issuer/audience/만료/역할을 검사하며 이메일은 요구하지 않는다", async () => {
    const pair = await generateKeyPair("ES256");
    const key = createLocalJWKSet({
      keys: [{ ...(await exportJWK(pair.publicKey)), kid: "test" }],
    });
    const issuer = "https://example.supabase.co/auth/v1";
    const token = async (overrides = {}) =>
      new SignJWT({ role: "authenticated", ...overrides })
        .setProtectedHeader({ alg: "ES256", kid: "test" })
        .setSubject(owner)
        .setIssuedAt()
        .setIssuer(issuer)
        .setAudience("authenticated")
        .setExpirationTime("5m")
        .sign(pair.privateKey);
    expect(await verifyUser(await token(), issuer, key)).toBe(owner);
    await expect(
      verifyUser(await token(), issuer + "/other", key),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      verifyUser(await token({ role: "service_role" }), issuer, key),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      verifyUser(await token({ is_anonymous: true }), issuer, key),
    ).rejects.toMatchObject({ status: 401 });
    const expired = await new SignJWT({ role: "authenticated" })
      .setProtectedHeader({ alg: "ES256", kid: "test" })
      .setSubject(owner)
      .setIssuedAt()
      .setIssuer(issuer)
      .setAudience("authenticated")
      .setExpirationTime(1)
      .sign(pair.privateKey);
    await expect(verifyUser(expired, issuer, key)).rejects.toMatchObject({
      status: 401,
    });
    const other = await generateKeyPair("ES256");
    const badKey = createLocalJWKSet({
      keys: [{ ...(await exportJWK(other.publicKey)), kid: "test" }],
    });
    await expect(
      verifyUser(await token(), issuer, badKey),
    ).rejects.toMatchObject({ status: 401 });
  });
  it("실제 바이트 제한 및 비밀을 포함한 오류 은닉", async () => {
    const request = new Request("https://be.test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ huge: "가".repeat(2000) }),
    });
    await expect(body(request, readingRequestInput)).rejects.toMatchObject({
      status: 413,
    });
    const response = await endpoint(async () => {
      throw new Error("token-secret");
    });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.text()).not.toContain("token-secret");
  });
  it("AI의 미완성/HTML 응답은 결과로 저장하지 않는다", async () => {
    const id = await order();
    const [row] = await db.query<{ snapshot: unknown }>(
      "select snapshot from private.order_snapshots where order_id=$1",
      [id],
    );
    const { snapshotSchema } =
      await import("../src/lib/backend/generation-contract");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          status: "completed",
          model: "test-only-model",
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    ...content,
                    summary: "<script>bad</script>",
                  }),
                },
              ],
            },
          ],
        }),
      ),
    );
    await expect(
      generateText(snapshotSchema.parse(row.snapshot)),
    ).rejects.toMatchObject({ code: "GENERATION_INVALID_RESPONSE" });
  });
});

describe("운영 경계 회귀", () => {
  it("공급자가 실패해도 사전 예약 예산은 남는다", async () => {
    await expect(
      createPreview(db, birth, async () => {
        throw new Error("upstream failed");
      }),
    ).rejects.toThrow();
    const [usage] = await db.query<{ count: number }>(
      "select count from private.usage_limits where key='sazu-provider-daily'",
    );
    expect(usage.count).toBe(1);
    expect(await db.query("select * from private.previews")).toHaveLength(0);
  });
  it("service_role 권한으로 저장/조회/상태 전환이 작동한다", async () => {
    await pg.exec("set role service_role");
    try {
      const id = await paid();
      expect((await orderStatus(db, owner, id)).data.status).toBe("paid");
      await runGeneration(db, async () => ({
        content,
        model: "test-only-model",
      }));
      expect((await listReadings(db, owner, 0)).data).toHaveLength(1);
    } finally {
      await pg.exec("reset role");
    }
  });
  it("한자 카탈로그 미반입이어도 입력 보관은 가능하다", async () => {
    await db.query("delete from private.active_catalog");
    const id = await save();
    expect((await getRequest(db, owner, id)).data).toBeDefined();
    await expect(analyzeName(db, name)).rejects.toMatchObject({
      code: "CATALOG_NOT_READY",
    });
  });
  it("HTTP에서 BFF/회원/worker 인증을 DB 호출보다 먼저 검사한다", async () => {
    const { GET: getOrder } = await import("../src/app/api/orders/[id]/route");
    const { GET: cron } =
      await import("../src/app/api/internal/generation/route");
    const { POST: nameRoute } = await import("../src/app/api/name/route");
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("CRON_SECRET", "test-only-cron");
    expect(
      (
        await getOrder(new Request("https://be.test"), {
          params: Promise.resolve({ id: randomUUID() }),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await getOrder(
          new Request("https://be.test", {
            headers: { "x-bff-secret": "test-bff-secret" },
          }),
          { params: Promise.resolve({ id: randomUUID() }) },
        )
      ).status,
    ).toBe(401);
    expect((await cron(new Request("https://be.test"))).status).toBe(401);
    expect(
      (
        await nameRoute(
          new Request("https://be.test", {
            method: "POST",
            headers: {
              "x-bff-secret": "test-bff-secret",
              "content-type": "application/json",
            },
            body: JSON.stringify({ ...name, strokes: [1, 1, 1] }),
          }),
        )
      ).status,
    ).toBe(400);
  });
  it("운영 웹훅은 등록된 PG 없이 외부 본문을 승인으로 받지 않는다", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { POST } = await import("../src/app/api/payments/webhook/route");
    const response = await POST(
      new Request("https://be.test/api/payments/webhook", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ paid: true, userId: owner }),
      }),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "PAYMENT_NOT_READY" },
    });
  });
});

describe("확장 미리보기 계약", () => {
  it("시각 미상은 시주와 전체 명식 기반 모듈 및 원자료를 내보내지 않는다", () => {
    const output = previewFields(
      {
        source: "SAZU",
        sandbox: true,
        modules: {
          ...modules,
          sinStrength: { strength: "신강" },
          wongukInteraction: { relations: [] },
        },
        providerData: {
          topics: ["manse"],
          modules: { hiddenHour: "must-not-leak" },
          glossary: {},
        },
      },
      { ...birth, birthHour: null },
    );
    expect(output.modules.fourPillars.hour).toBeNull();
    expect(Object.keys(output.modules)).toEqual(["fourPillars"]);
    expect(output.providerData).toBeUndefined();
  });
  it("이전 계약의 캐시를 재사용하지 않고 확장 응답을 새로 저장한다", async () => {
    const analyze = vi.fn(async () => ({
      source: "SAZU" as const,
      sandbox: true,
      modules,
    }));
    const first = await createPreview(db, birth, analyze);
    await db.query(
      "update private.previews set provider_version='old-v1' where id=$1",
      [first.id],
    );
    expect(await matchingPreview(db, first.id, birth)).toBeUndefined();
    const next = await createPreview(db, birth, analyze);
    expect(next.id).not.toBe(first.id);
    expect(analyze).toHaveBeenCalledTimes(2);
  });
  it("시각이 있는 확장 요청은 공급자 호출 2회분을 예약한다", async () => {
    await createPreview(db, { ...birth, birthHour: 10 }, async () => ({
      source: "SAZU",
      sandbox: true,
      modules,
    }));
    const [usage] = await db.query<{ count: number }>(
      "select count from private.usage_limits where key='sazu-provider-daily'",
    );
    expect(usage.count).toBe(2);
  });
});

import { z } from "zod";
import fortunes from "@/data/suri_81.json";
import {
  catalogSchema,
  hanjaSchema,
  nameResponseSchema,
} from "@/lib/name-contract";
import type { Queryable } from "./db";
import { fail } from "./http";
export type Hanja = z.infer<typeof hanjaSchema>;
type Element = Hanja["element"];
export const nameInput = z
  .object({
    name: z.string().regex(/^[가-힣]{3}$/),
    hanjaIds: z.array(z.string().min(1).max(80)).length(3),
  })
  .strict();
export const evidenceSchema = z
  .object({
    registrationSource: z.url().startsWith("https://"),
    license: z.string().min(1).max(2000),
    reviewedAt: z.iso.date(),
    reviewer: z.string().min(1).max(100),
    originalStrokeRule: z.string().min(1).max(2000),
    radicalAdjustment: z.string().min(1).max(2000),
    variantOf: z.string().max(80).nullable(),
    elementEvidence: z.string().min(1).max(2000).nullable(),
    bulyongEvidence: z.string().min(1).max(2000).nullable(),
  })
  .strict();
export const catalogImportSchema = z
  .object({
    catalog: catalogSchema,
    metadata: z
      .object({
        scope: z.enum(["full-personal-name-catalog", "partial-source-preview"]),
        sourceVersion: z.string().min(1),
        license: z.string().min(1),
        reviewedAt: z.iso.date(),
        rules: z.string().min(1),
      })
      .strict(),
    entries: z
      .array(
        z.object({ entry: hanjaSchema, evidence: evidenceSchema }).strict(),
      )
      .min(1)
      .max(100000),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.catalog.status === "verified" &&
      value.metadata.scope !== "full-personal-name-catalog"
    )
      ctx.addIssue({
        code: "custom",
        message: "부분 자료는 검수 완료로 등록할 수 없습니다.",
      });
    const ids = new Set<string>();
    const counts = new Map<string, number>();
    for (const { entry: h, evidence: e } of value.entries) {
      if (ids.has(h.id)) ctx.addIssue({ code: "custom", message: "중복 ID" });
      ids.add(h.id);
      counts.set(h.reading, (counts.get(h.reading) ?? 0) + 1);
      if (
        (h.element !== null && !e.elementEvidence) ||
        (h.isBulyong !== null && !e.bulyongEvidence)
      )
        ctx.addIssue({ code: "custom", message: "오행/불용 근거 필요" });
      if (
        value.catalog.status === "verified" &&
        (h.strokeReview !== "reference-checked" ||
          h.dictionaryStrokes === null ||
          !h.strokeSources.some((s) => s.basis === "naming-original") ||
          !h.strokeSources.some((s) => s.basis === "dictionary"))
      )
        ctx.addIssue({ code: "custom", message: "원획/사전 출처 검수 필요" });
    }
    if ([...counts.values()].some((n) => n > 2000))
      ctx.addIssue({ code: "custom", message: "음별 2000자 계약 초과" });
  });
export async function activeCatalog(db: Queryable) {
  const [row] = await db.query<{ status: string; version: string }>(
    "select c.status,c.version from private.catalogs c join private.active_catalog a on a.version=c.version",
  );
  if (!row) fail(503, "CATALOG_NOT_READY", "한자 자료를 검수하고 있어요.");
  return catalogSchema.parse(row);
}
export async function findHanja(db: Queryable, reading: string, q: string) {
  const catalog = await activeCatalog(db);
  const rows = await db.query<{ entry: Hanja }>(
    `select entry from private.catalog_entries where version=$1 and reading=$2 and (
      $3='' or strpos(regexp_replace((entry->>'character')||(entry->>'meaning')||reading,'[[:space:]]','','g'),$3)>0
      or exists (
        select 1 from jsonb_array_elements_text(coalesce(entry->'searchAliases','[]'::jsonb)) as alias(value)
        where strpos(regexp_replace(alias.value,'[[:space:]]','','g'),$3)>0
      )
      or exists (
        select 1 from jsonb_array_elements_text(coalesce(entry->'meanings','[]'::jsonb)) as gloss(value)
        where strpos(regexp_replace(gloss.value||reading,'[[:space:]]','','g'),$3)>0
      )
    ) order by case when entry->>'meaningStatus'='unavailable' then 1 else 0 end,id limit 2001`,
    [catalog.version, reading, q.replace(/\s/gu, "")],
  );
  if (rows.length > 2000) fail(503, "CATALOG_CONTRACT_EXCEEDED");
  return { data: rows.map((r) => hanjaSchema.parse(r.entry)), catalog };
}
export function normalizeSuri(n: number): number {
  if (!Number.isSafeInteger(n) || n < 1) fail(400, "INVALID_INPUT");
  return n <= 81 ? n : ((n - 2) % 80) + 2;
}
export function soundElement(s: string): Element {
  if (!/^[가-힣]$/.test(s)) return null;
  const elements: Record<number, Element> = {
    0: "목",
    15: "목",
    2: "화",
    3: "화",
    5: "화",
    16: "화",
    11: "토",
    18: "토",
    9: "금",
    12: "금",
    14: "금",
    6: "수",
    7: "수",
    17: "수",
  };
  return elements[Math.floor((s.charCodeAt(0) - 0xac00) / 588)] ?? null;
}
export function relationship(a: Element, b: Element): string {
  if (!a || !b) return "분류 확인 필요";
  if (a === b) return "같은 오행";
  const generates = { 목: "화", 화: "토", 토: "금", 금: "수", 수: "목" };
  const overcomes = { 목: "토", 토: "수", 수: "화", 화: "금", 금: "목" };
  return generates[a] === b
    ? "상생"
    : overcomes[a] === b
      ? "상극"
      : generates[b] === a
        ? "역방향 상생"
        : "역방향 상극";
}
export async function analyzeName(
  db: Queryable,
  input: z.infer<typeof nameInput>,
  verified = false,
) {
  const catalog = await activeCatalog(db);
  if (verified && catalog.status !== "verified")
    fail(409, "UNVERIFIED_CATALOG", "검수된 한자 자료로만 결제할 수 있어요.");
  const rows = await db.query<{ entry: Hanja }>(
    "select entry from private.catalog_entries where version=$1 and id=any($2::text[])",
    [catalog.version, input.hanjaIds],
  );
  const hanja = input.hanjaIds.map((id, i) => {
    const h = rows.find((r) => r.entry.id === id)?.entry;
    if (!h || h.reading !== input.name[i])
      fail(400, "HANJA_MISMATCH", "이름에 맞는 한자를 선택해 주세요.");
    return hanjaSchema.parse(h);
  });
  if (
    verified &&
    hanja.some(
      (h) =>
        h.strokeReview !== "reference-checked" ||
        !h.strokeSources.some((s) => s.basis === "dictionary"),
    )
  )
    fail(409, "UNVERIFIED_CATALOG");
  const [s, a, b] = hanja.map((h) => {
    if (h.dictionaryStrokes === null)
      fail(409, "WRITTEN_STROKES_UNAVAILABLE", "실제 획수가 확인되지 않은 한자가 있어 수리를 계산할 수 없어요.");
    return h.dictionaryStrokes;
  });
  const grids = [
    ["원격", "초년운", a + b],
    ["형격", "청년운", s + a],
    ["이격", "중년운", s + b],
    ["정격", "총운", s + a + b],
  ].map(([label, period, total]) => {
    const number = normalizeSuri(total as number);
    return {
      label,
      period,
      total,
      number,
      ...(
        fortunes as Record<
          string,
          { title: string; fortune: string; description: string }
        >
      )[number],
    };
  });
  const sounds = [...input.name].map((syllable) => ({
    syllable,
    element: soundElement(syllable),
  }));
  return nameResponseSchema.parse({
    data: {
      name: input.name,
      hanja,
      grids,
      sounds,
      relations: [
        relationship(sounds[0].element, sounds[1].element),
        relationship(sounds[1].element, sounds[2].element),
      ],
    },
    catalog,
  });
}

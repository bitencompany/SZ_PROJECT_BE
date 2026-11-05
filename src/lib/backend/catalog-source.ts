import { createHash } from "node:crypto";
import { z } from "zod";
import { catalogImportSchema } from "./catalog";

export const sourceOrigin = "https://jakmyeongdang.com";
export const indexUrl = `${sourceOrigin}/data/hanja/index.json`;
export const documentationUrl = `${sourceOrigin}/ai-resources`;
const reading = z.string().regex(/^[가-힣]$/);
function sourceUrl(path: RegExp) {
  return z.url().refine((v) => {
    const u = new URL(v);
    return (
      u.origin === sourceOrigin &&
      path.test(u.pathname) &&
      !u.search &&
      !u.hash &&
      !u.username &&
      !u.password
    );
  });
}
const pageUrl = sourceUrl(/^\/hanja\/[^/]+$/);
const dataUrl = sourceUrl(/^\/data\/hanja\/u[a-f0-9]+\.json$/);
const header = {
  schema_version: z.literal(1),
  origin: z.literal(sourceOrigin),
  snapshot_date: z.iso.date(),
  source: z.string().min(1).max(200),
  release: z.string().min(1).max(150),
};
export const sourceIndexSchema = z
  .object({
    ...header,
    count: z.number().int().positive().max(2000),
    readings: z
      .array(
        z.object({
          reading,
          count: z.number().int().nonnegative().max(2000),
          page_url: pageUrl,
          data_url: dataUrl,
        }),
      )
      .max(2000),
  })
  .superRefine((v, ctx) => {
    if (
      v.count !== v.readings.length ||
      new Set(v.readings.map((r) => r.reading)).size !== v.count ||
      new Set(v.readings.map((r) => r.data_url)).size !== v.count
    )
      ctx.addIssue({
        code: "custom",
        message: "색인의 항목 수 또는 중복 오류",
      });
  });
export const sourcePageSchema = z.object({
  ...header,
  reading,
  page_url: pageUrl,
  count: z.number().int().nonnegative().max(2000),
  entries: z
    .array(
      z.object({
        hanja: z.string().regex(/^\p{Script=Han}$/u),
        reading,
        meanings: z.array(z.string().trim().min(1).max(100)).min(1).max(30),
        strokes: z.number().int().positive().max(100).nullable(),
      }),
    )
    .max(2000),
});
export const sourceUseNotice =
  "작명당 공개 JSON 안내에 따른 출처 표시·개발 검증용 캐시. 별도 오픈 라이선스 및 상업 서비스 DB 재배포 허락은 미확인. https://jakmyeongdang.com/ai-resources";

export function buildSourceCatalog(
  rawIndex: unknown,
  rawPages: unknown[],
  checkedAt: string,
) {
  const index = sourceIndexSchema.parse(rawIndex);
  z.iso.date().parse(checkedAt);
  const pages = rawPages
    .map((p) => sourcePageSchema.parse(p))
    .sort((a, b) => a.reading.localeCompare(b.reading, "ko"));
  if (
    pages.length !== index.count ||
    new Set(pages.map((p) => p.reading)).size !== index.count
  )
    throw new Error("SOURCE_PAGE_SET_MISMATCH");
  const skipped: { reading: string; character: string; reason: string }[] = [];
  const entries = pages.flatMap((page) => {
    const item = index.readings.find((r) => r.reading === page.reading);
    if (
      !item ||
      page.release !== index.release ||
      page.snapshot_date !== index.snapshot_date ||
      page.source !== index.source ||
      page.page_url !== item.page_url ||
      page.count !== item.count ||
      page.entries.length !== page.count
    )
      throw new Error("SOURCE_SNAPSHOT_MISMATCH");
    if (new Set(page.entries.map((h) => h.hanja)).size !== page.count)
      throw new Error("SOURCE_DUPLICATE_CHARACTER");
    return page.entries.flatMap((h) => {
      if (h.reading !== page.reading)
        throw new Error("SOURCE_READING_MISMATCH");
      if (h.strokes === null) {
        skipped.push({
          reading: h.reading,
          character: h.hanja,
          reason: "원획 미수록",
        });
        return [];
      }
      const meaning = h.meanings.join(" · ");
      if (meaning.length > 100) throw new Error("SOURCE_MEANING_TOO_LONG");
      return [
        {
          entry: {
            id: `jmd-${h.hanja.codePointAt(0)!.toString(16)}-${h.reading.codePointAt(0)!.toString(16)}`,
            reading: h.reading,
            character: h.hanja,
            meaning,
            strokes: h.strokes,
            dictionaryStrokes: null,
            element: null,
            isBulyong: null,
            strokeReview: "unreviewed" as const,
            strokeSources: [
              {
                title: `작명당 공개 원획 · ${index.snapshot_date}`,
                url: page.page_url,
                basis: "naming-original" as const,
              },
            ],
          },
          evidence: {
            registrationSource: page.page_url,
            license: sourceUseNotice,
            reviewedAt: checkedAt,
            reviewer: "자동 구조 검증만 수행; 원획·인명용 독립 검수 미완료",
            originalStrokeRule:
              "공급자가 원획으로 표기한 값을 보존. 사전 총획에서 자동 보정하지 않음.",
            radicalAdjustment:
              "공급자의 글자별 보정 근거 미제공; 독립 검수 미완료",
            variantOf: null,
            elementEvidence: null,
            bulyongEvidence: null,
          },
        },
      ];
    });
  });
  const hash = createHash("sha256")
    .update(JSON.stringify({ index, pages }))
    .digest("hex");
  const catalog = catalogImportSchema.parse({
    catalog: {
      status: "preview",
      version: `jmd-preview-${index.snapshot_date}-${hash.slice(0, 12)}`,
    },
    metadata: {
      scope: "partial-source-preview",
      sourceVersion: `${index.release}; snapshot=${index.snapshot_date}; sha256=${hash}`,
      license: sourceUseNotice,
      reviewedAt: checkedAt,
      rules:
        "공개 색인의 부분 범위만 수록. 원획 누락 제외. 전체 인명용 목록·독립 원획 검수 아님. 오행·불용·사전획수는 근거 없어 null.",
    },
    entries,
  });
  return {
    catalog,
    report: {
      version: catalog.catalog.version,
      checkedAt,
      source: documentationUrl,
      release: index.release,
      snapshotDate: index.snapshot_date,
      sha256: hash,
      readingCount: index.count,
      readings: pages.map((p) => p.reading),
      sourceEntries: pages.reduce((n, p) => n + p.count, 0),
      importedEntries: entries.length,
      uniqueCharacters: new Set(entries.map((h) => h.entry.character)).size,
      skipped,
      status: "preview",
      scope: "partial-source-preview",
      commercialReuse: "not-confirmed",
    },
  };
}

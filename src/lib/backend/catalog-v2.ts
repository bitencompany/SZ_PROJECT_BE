import { createHash } from "node:crypto";
import { z } from "zod";
import { catalogImportSchema } from "./catalog";

const url = z.url().startsWith("https://");
export const preparedHanjaSchema = z.object({
  sources: z.object({ courtSnapshot: url, dictionary: url, writtenStrokes: url }),
  hashes: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/)),
  rows: z.array(z.object({
    character: z.string().regex(/^\p{Script=Han}$/u),
    reading: z.string().regex(/^[가-힣]$/),
    meanings: z.array(z.string().trim().min(1).max(100)).max(100),
    writtenStrokes: z.number().int().positive().max(100),
  })).min(1).max(100000),
});

export function buildHanjaV2(raw: unknown, previous: unknown) {
  const input = preparedHanjaSchema.parse(raw);
  const old = catalogImportSchema.parse(previous);
  const key = (h: { character: string; reading: string }) => `${h.character}:${h.reading}`;
  const oldByPair = new Map(old.entries.map(({ entry }) => [key(entry), entry]));
  if (oldByPair.size !== old.entries.length) throw new Error("AMBIGUOUS_LEGACY_PAIR");
  const seen = new Set<string>();
  const entries = input.rows.map((row) => {
    if (seen.has(key(row))) throw new Error("DUPLICATE_CHARACTER_READING");
    seen.add(key(row));
    const previousEntry = oldByPair.get(key(row));
    const meanings = [...new Set(row.meanings)];
    const searchAliases = [...new Set([
      ...(previousEntry?.searchAliases ?? []),
      ...(meanings.some((meaning) => meaning === "성씨" || meaning === "사람의 성") ? [`성 ${row.reading}`] : []),
    ])];
    return {
      entry: {
        id: previousEntry?.id ?? `han-${row.character.codePointAt(0)!.toString(16)}-${row.reading.codePointAt(0)!.toString(16)}`,
        character: row.character,
        reading: row.reading,
        meaning: meanings[0] ?? "뜻 확인 중",
        meanings,
        meaningStatus: meanings.length ? "sourced" as const : "unavailable" as const,
        meaningSource: meanings.length ? input.sources.dictionary : null,
        readingSource: input.sources.courtSnapshot,
        ...(searchAliases.length ? { searchAliases } : {}),
        strokes: row.writtenStrokes,
        dictionaryStrokes: row.writtenStrokes,
        strokeBasis: "written" as const,
        // Sourced is not an assertion that every glyph has been manually reviewed.
        strokeReview: "unreviewed" as const,
        strokeSources: [{ title: "Unicode 17.0 실제 총획 · 한국 K 자형 우선", url: input.sources.writtenStrokes, basis: "dictionary" as const }],
        element: null,
        isBulyong: null,
      },
      evidence: {
        registrationSource: input.sources.courtSnapshot,
        license: "Court snapshot: MIT (rutopio); Korean glosses: libhangul hanja.txt BSD-3-Clause; strokes: Unicode License. Notices in src/data. No Naver dictionary data used.",
        reviewedAt: "2026-11-05",
        reviewer: "고정 출처·글자/독음 쌍·Unicode 교차 검증; 전수 수동 검수 아님",
        originalStrokeRule: "필획 전용. 원획 부수 환산 없음. strokes와 dictionaryStrokes는 모두 실제 총획.",
        radicalAdjustment: "Unihan kTotalStrokes; kAlternateTotalStrokes K 우선. 원획 보정하지 않음.",
        variantOf: null,
        elementEvidence: null,
        bulyongEvidence: null,
      },
    };
  });
  const digest = createHash("sha256").update(JSON.stringify({ input, entries })).digest("hex").slice(0, 12);
  const catalog = catalogImportSchema.parse({
    catalog: { status: "preview", version: `hanja-v2-20261105-${digest}` },
    metadata: {
      scope: "partial-source-preview",
      sourceVersion: JSON.stringify({ ...input.sources, hashes: input.hashes }),
      license: "libhangul data BSD-3-Clause; court snapshot MIT; Unicode License. Each source notice retained separately.",
      reviewedAt: "2026-11-05",
      rules: "법원 2024 목록의 공개 수집본 기반. 비표준 코드 제외. 최신 법적 사용 가능 여부 확정 자료 아님. 한국어 훈음은 libhangul의 해당 독음 항목에서 분리. 뜻 미확보는 명시적으로 unavailable. 다른 독음의 뜻/옛 작명당 뜻으로 대체하지 않음. 필획만 계산. 기존 ID는 동일 글자+독음에만 유지.",
    },
    entries,
  });
  return {
    catalog,
    report: {
      version: catalog.catalog.version,
      entries: entries.length,
      readings: new Set(entries.map(({ entry }) => entry.reading)).size,
      sourcedMeanings: entries.filter(({ entry }) => entry.meaningStatus === "sourced").length,
      unavailableMeanings: entries.filter(({ entry }) => entry.meaningStatus === "unavailable").length,
      preservedIds: entries.filter(({ entry }) => oldByPair.has(key(entry))).length,
      removed: old.entries.filter(({ entry }) => !seen.has(key(entry))).map(({ entry }) => ({ id: entry.id, character: entry.character, reading: entry.reading })),
      changedMeanings: entries.flatMap(({ entry }) => {
        const before = oldByPair.get(key(entry));
        return before && before.meaning !== entry.meaning ? [{ character: entry.character, reading: entry.reading, before: before.meaning, after: entry.meaning }] : [];
      }),
    },
  };
}

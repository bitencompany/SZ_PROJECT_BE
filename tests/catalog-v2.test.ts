import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { buildHanjaV2 } from "../src/lib/backend/catalog-v2";
import { gangSupplements } from "../src/lib/backend/catalog-supplements";

const previous = {
  catalog: { status: "preview", version: "old" },
  metadata: { scope: "partial-source-preview", sourceVersion: "test", license: "test", reviewedAt: "2026-11-05", rules: "test" },
  entries: gangSupplements,
};
const prepared = {
  sources: { courtSnapshot: "https://example.test/court", dictionary: "https://example.test/gloss", writtenStrokes: "https://example.test/strokes" },
  hashes: { input: "a".repeat(64) },
  rows: [
    { character: "姜", reading: "강", meanings: ["성씨", "강할"], writtenStrokes: 9 },
    { character: "康", reading: "강", meanings: ["편안할"], writtenStrokes: 11 },
    { character: "泰", reading: "태", meanings: ["클", "통할"], writtenStrokes: 10 },
    { character: "樂", reading: "악", meanings: ["풍류"], writtenStrokes: 15 },
    { character: "樂", reading: "락", meanings: ["즐거울"], writtenStrokes: 15 },
    { character: "䬈", reading: "태", meanings: [], writtenStrokes: 16 },
  ],
};

describe("한자 공급 데이터 교체", () => {
  it("동일 글자·음만 기존 ID를 유지하고 뜻·획수를 새 출처로 교체한다", () => {
    const { catalog, report } = buildHanjaV2(prepared, previous);
    expect(report.preservedIds).toBe(2);
    expect(report.removed.map((item) => item.character)).toEqual(["江"]);
    const gang = catalog.entries[0].entry;
    expect(gang.id).toBe(gangSupplements[0].entry.id);
    expect(gang.searchAliases).toEqual(["진주 강씨", "성 강"]);
    expect(gang.meaning).toBe("성씨");
    expect(gang.meanings).toEqual(["성씨", "강할"]);
    const tae = catalog.entries[2].entry;
    expect([tae.strokes, tae.dictionaryStrokes, tae.strokeBasis]).toEqual([10, 10, "written"]);
    expect(catalog.catalog.status).toBe("preview");
    expect(buildHanjaV2(prepared, previous).catalog).toEqual(catalog);
  });
  it("다른 음의 뜻을 합치지 않고 뜻 미확보를 명시한다", () => {
    const { catalog } = buildHanjaV2(prepared, previous);
    expect(catalog.entries[3].entry.meaning).toBe("풍류");
    expect(catalog.entries[4].entry.meaning).toBe("즐거울");
    expect(catalog.entries[5].entry).toMatchObject({ meaning: "뜻 확인 중", meaningStatus: "unavailable", meaningSource: null, meanings: [] });
  });
  it("중복 글자·음, 비표준 코드, 비정상 획수를 거부한다", () => {
    expect(() => buildHanjaV2({ ...prepared, rows: [prepared.rows[0], prepared.rows[0]] }, previous)).toThrow("DUPLICATE_CHARACTER_READING");
    for (const row of [{ ...prepared.rows[0], character: "\ue000" }, { ...prepared.rows[0], writtenStrokes: 0 }])
      expect(() => buildHanjaV2({ ...prepared, rows: [row] }, previous)).toThrow();
  });
});

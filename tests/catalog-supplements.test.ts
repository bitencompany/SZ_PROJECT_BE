import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import {
  gangSupplements,
  supplementGangCatalog,
} from "../src/lib/backend/catalog-supplements";

describe("강 독음 보완", () => {
  const base = {
    catalog: { status: "preview", version: "synthetic-base" },
    metadata: {
      scope: "partial-source-preview",
      sourceVersion: "test",
      license: "test",
      reviewedAt: "2026-11-05",
      rules: "test",
    },
    entries: [
      {
        ...gangSupplements[0],
        entry: {
          ...gangSupplements[0].entry,
          id: "synthetic-yi",
          reading: "이",
          character: "李",
          searchAliases: [],
        },
      },
    ],
  };
  it("기존 선택 ID를 보존하고 서로 다른 강 한자와 두 획수 출처를 추가한다", () => {
    const next = supplementGangCatalog(base);
    expect(next.entries[0].entry.id).toBe(base.entries[0].entry.id);
    expect(next.entries[0].entry.character).toBe("李");
    expect(next.entries[0].entry.dictionaryStrokes).toBe(7);
    expect(next.catalog.status).toBe("preview");
    expect(next.catalog.version).not.toBe(base.catalog.version);
    expect(next.entries.find(({ entry }) => entry.character === "姜")?.entry.searchAliases)
      .toEqual(["진주 강씨"]);
    expect(
      next.entries
        .slice(1)
        .map(({ entry }) => [
          entry.character,
          entry.strokes,
          entry.dictionaryStrokes,
        ]),
    ).toEqual([
      ["姜", 9, 9],
      ["康", 11, 11],
      ["江", 7, 6],
    ]);
    expect(
      next.entries
        .slice(1)
        .every(({ entry }) => entry.strokeSources.length === 2),
    ).toBe(true);
  });
  it("중복 반입 또는 검수 완료 카탈로그의 임의 변경을 거절한다", () => {
    expect(() => supplementGangCatalog(supplementGangCatalog(base))).toThrow(
      "SUPPLEMENT_ALREADY_EXISTS",
    );
    expect(() =>
      supplementGangCatalog({
        ...base,
        catalog: { ...base.catalog, status: "verified" },
      }),
    ).toThrow();
  });
});

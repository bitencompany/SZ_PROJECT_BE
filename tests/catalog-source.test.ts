import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import {
  buildSourceCatalog,
  sourceIndexSchema,
  sourceOrigin,
} from "../src/lib/backend/catalog-source";
import { catalogImportSchema } from "../src/lib/backend/catalog";

// Synthetic protocol fixtures, not a distributed copy of the supplier's dictionary.
const header = {
  schema_version: 1,
  origin: sourceOrigin,
  snapshot_date: "2026-11-05",
  source: "test fixture",
  release: "test-v1",
};
const page = {
  ...header,
  reading: "윤",
  page_url: `${sourceOrigin}/hanja/%EC%9C%A4`,
  count: 2,
  entries: [
    { hanja: "潤", reading: "윤", meanings: ["윤택할"], strokes: 16 },
    { hanja: "允", reading: "윤", meanings: ["진실로"], strokes: null },
  ],
};
const index = {
  ...header,
  count: 1,
  readings: [
    {
      reading: "윤",
      count: 2,
      page_url: page.page_url,
      data_url: `${sourceOrigin}/data/hanja/uc724.json`,
    },
  ],
};
const build = (p: unknown = page) =>
  buildSourceCatalog(index, [p], "2026-11-05");

describe("public dictionary ingestion", () => {
  it("preserves provider strokes and attribution without inventing dictionary strokes or verification", () => {
    const { catalog, report } = build();
    expect(catalog.catalog.status).toBe("preview");
    expect(catalog.metadata.scope).toBe("partial-source-preview");
    expect(catalog.entries[0].entry).toMatchObject({
      character: "潤",
      strokes: 16,
      dictionaryStrokes: null,
      strokeReview: "unreviewed",
      element: null,
      isBulyong: null,
    });
    expect(catalog.entries[0].entry.strokeSources[0].url).toBe(page.page_url);
    expect(report.skipped).toEqual([
      { character: "允", reading: "윤", reason: "원획 미수록" },
    ]);
    expect(report.importedEntries).toBe(1);
    expect(build().catalog.catalog.version).toBe(catalog.catalog.version);
  });
  it("rejects incomplete, duplicated and mixed-version snapshots", () => {
    expect(() => buildSourceCatalog(index, [], "2026-11-05")).toThrow();
    expect(() => build({ ...page, release: "other" })).toThrow(
      "SOURCE_SNAPSHOT_MISMATCH",
    );
    expect(() => build({ ...page, count: 1 })).toThrow(
      "SOURCE_SNAPSHOT_MISMATCH",
    );
    expect(() =>
      build({ ...page, entries: [page.entries[0], page.entries[0]] }),
    ).toThrow("SOURCE_DUPLICATE_CHARACTER");
    expect(() =>
      build({
        ...page,
        entries: [{ ...page.entries[0], reading: "서" }, page.entries[1]],
      }),
    ).toThrow("SOURCE_READING_MISMATCH");
  });
  it("rejects external URLs, credentials, query strings and invalid strokes", () => {
    for (const url of [
      "https://invalid.example/data/hanja/uc724.json",
      "http://jakmyeongdang.com/data/hanja/uc724.json",
      `${sourceOrigin}/data/hanja/uc724.json?token=x`,
      "https://user:pass@jakmyeongdang.com/data/hanja/uc724.json",
    ]) {
      expect(
        sourceIndexSchema.safeParse({
          ...index,
          readings: [{ ...index.readings[0], data_url: url }],
        }).success,
      ).toBe(false);
    }
    expect(() =>
      build({
        ...page,
        entries: [{ ...page.entries[0], strokes: 0 }, page.entries[1]],
      }),
    ).toThrow();
  });
  it("does not permit a partial catalog to be promoted to verified, even with stroke references", () => {
    const { catalog } = build();
    catalog.catalog.status = "verified";
    for (const item of catalog.entries) {
      item.entry.dictionaryStrokes = 15;
      item.entry.strokeReview = "reference-checked";
      item.entry.strokeSources.push({
        title: "synthetic dictionary",
        url: "https://example.test/dictionary",
        basis: "dictionary",
      });
    }
    expect(catalogImportSchema.safeParse(catalog).success).toBe(false);
  });
});

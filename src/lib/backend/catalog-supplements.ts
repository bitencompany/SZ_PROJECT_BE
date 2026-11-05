import { createHash } from "node:crypto";
import { catalogImportSchema } from "./catalog";
import writtenStrokes from "../../data/written-strokes.json";

// Small, individually cross-checked factual additions, not a copied dictionary.
// Keep the two stroke systems distinct: 江 is 6 written strokes and 7 Kangxi strokes.
export const gangSupplements = [
  { character: "姜", meaning: "성", strokes: 9, dictionaryStrokes: 9, searchAliases: ["진주 강씨"] },
  { character: "康", meaning: "편안할", strokes: 11, dictionaryStrokes: 11 },
  { character: "江", meaning: "강", strokes: 7, dictionaryStrokes: 6 },
].map((value) => {
  const dictionary = `https://www.zdic.net/hans/${encodeURIComponent(value.character)}`;
  return {
    entry: {
      ...value,
      id: `ref-${value.character.codePointAt(0)!.toString(16)}-ac15`,
      reading: "강",
      element: null,
      isBulyong: null,
      strokeReview: "reference-checked" as const,
      strokeSources: [
        {
          title: "한전 총필획 · 2026-11-05 대조",
          url: dictionary,
          basis: "dictionary" as const,
        },
        {
          title: "한전 강희자전 획수 · 2026-11-05 대조",
          url: `${dictionary}#kangxi`,
          basis: "naming-original" as const,
        },
      ],
    },
    evidence: {
      registrationSource: "https://help.scourt.go.kr/nm/images/hanja/hanja.pdf",
      license:
        "개별 한자 3자의 독음·뜻·획수 사실을 대조하여 작성. 사전 설명 원문·이미지 미복제. 기존 공급자 자료의 이용 조건은 별도 유지.",
      reviewedAt: "2026-11-05",
      reviewer:
        "이름결 자료 대조: 법원 강 독음 목록, 한전 총필획·강희자전 항목",
      originalStrokeRule:
        "한전의 강희자전 획수를 원획 참고값으로 사용. 일반 총필획과 별도 저장.",
      radicalAdjustment:
        value.character === "江"
          ? "氵 3획을 水 4획으로 계산: 필획 6, 원획 7."
          : "부수 환산에 따른 차이 없음. 필획과 원획 일치.",
      variantOf: null,
      elementEvidence: null,
      bulyongEvidence: null,
    },
  };
});

export function supplementGangCatalog(raw: unknown) {
  const base = catalogImportSchema.parse(raw);
  if (base.catalog.status !== "preview")
    throw new Error("PREVIEW_CATALOG_REQUIRED");
  const entries = [...base.entries];
  for (const item of gangSupplements) {
    if (
      entries.some(
        ({ entry }) =>
          entry.id === item.entry.id ||
          (entry.character === item.entry.character &&
            entry.reading === item.entry.reading),
      )
    )
      throw new Error("SUPPLEMENT_ALREADY_EXISTS");
    entries.push(structuredClone(item));
  }
  for (const { entry } of entries) {
    entry.dictionaryStrokes = (writtenStrokes.strokes as Record<string, number>)[entry.character] ?? null;
    if (entry.dictionaryStrokes !== null) {
      entry.strokeSources = [
        ...entry.strokeSources.filter((source) => source.basis !== "dictionary"),
        { title: "Unicode 17.0 실제 총획 (한국 자형 차이 반영)", url: writtenStrokes.source, basis: "dictionary" },
      ];
    }
  }
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        base: base.catalog.version,
        additions: gangSupplements,
        writtenStrokes,
      }),
    )
    .digest("hex")
    .slice(0, 12);
  return catalogImportSchema.parse({
    ...base,
    catalog: { status: "preview", version: `supplement-2026-11-05-${digest}` },
    metadata: {
      ...base.metadata,
      sourceVersion: `${base.metadata.sourceVersion}; base=${base.catalog.version}; gang-supplement-v2; written-strokes-unicode17`,
      rules: `${base.metadata.rules} 강 독음 姜·康·江 3자 추가. 姜 본관 검색어 '진주 강씨': https://encykorea.aks.ac.kr/Article/E0001360 대조. 본관은 검색 별칭이며 한자를 자동 결정하지 않음. 전체 성씨·본관 목록 아님. 계산·표시는 dictionaryStrokes 실제 필획 사용: Unicode 17 kTotalStrokes, kAlternateTotalStrokes K 우선. 기존 strokes는 원자료 보존용이며 계산하지 않음. Unicode 라이선스: https://www.unicode.org/license.txt`,
    },
    entries,
  });
}

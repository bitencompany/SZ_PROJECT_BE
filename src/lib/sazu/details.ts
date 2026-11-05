import { z } from "zod";

const text = z.string().min(1).max(300);
const element = z.enum(["목", "화", "토", "금", "수"]);
const phase = z.object({
  keyword: text.optional(),
  season: text.optional(),
  phase: text.optional(),
});
const hidden = z.object({
  stem: text,
  days: z.number().finite().nonnegative().optional(),
});
export const detailedPillarSchema = z.object({
  full: text,
  sky: text.optional(),
  earth: text.optional(),
  skyElement: element.optional(),
  earthElement: element.optional(),
  sippiSeong: text.optional(),
  earthSippiSeong: text.optional(),
  twelveStage: text.optional(),
  naeeum: text.optional(),
  jiJangGan: z
    .object({
      residue: hidden.nullable().optional(),
      middle: hidden.nullable().optional(),
      main: hidden.nullable().optional(),
    })
    .optional(),
  twelveFortuneInterpretation: phase.optional(),
});
const marker = z.object({ name: text, pillars: z.array(text).max(8) });
export const detailModulesShape = {
  sinStrength: z
    .object({
      strength: text,
      score: z.number().finite().optional(),
      analysis: z.string().max(4000).optional(),
    })
    .optional(),
  decadeFortune: z
    .object({
      direction: text,
      startAge: z.number().finite().nonnegative().optional(),
      startDateTime: text.optional(),
      basisTermsName: text.optional(),
      list: z
        .array(
          z.object({
            startAge: z.number().finite().nonnegative(),
            full: text,
            sipseong: z.object({ gan: text.optional() }).optional(),
            twelveFortune: phase.extend({ name: text.optional() }).optional(),
          }),
        )
        .max(30),
    })
    .optional(),
  wongukInteraction: z
    .object({
      relations: z
        .array(
          z.object({
            type: text,
            source: text,
            target: text,
            sourcePosition: text,
            targetPosition: text,
            isAdjacent: z.boolean().optional(),
          }),
        )
        .max(100),
    })
    .optional(),
  gyeokguk: z
    .object({ name: text, reasoning: z.string().max(2000).optional() })
    .optional(),
  yongsin: z
    .object({
      yongsin: z.object({ ko: element }),
      huisin: z.object({ ko: element }).optional(),
      gisin: z.object({ ko: element }).optional(),
      gusin: z.object({ ko: element }).optional(),
      hansin: z.object({ ko: element }).optional(),
      johu: z.object({ ko: element }).optional(),
      method: text.optional(),
      reasoning: z.string().max(2000).optional(),
    })
    .optional(),
  evaluation: z
    .object({
      personality: z
        .object({
          keywords: z.array(text).max(30).optional(),
          strengths: z
            .array(z.object({ trait: text, basis: text }))
            .max(30)
            .optional(),
          cautions: z
            .array(z.object({ trait: text, basis: text }))
            .max(30)
            .optional(),
        })
        .optional(),
      scorecard: z
        .record(
          z.string().max(60),
          z.object({
            score: z.number().finite().optional(),
            grade: text.optional(),
            label: text,
          }),
        )
        .optional(),
    })
    .optional(),
  sinsal: z
    .object({
      angels: z.array(marker).max(50).optional(),
      devils: z.array(marker).max(50).optional(),
      twelve: z.array(marker).max(50).optional(),
    })
    .optional(),
};
export const detailModulesSchema = z.object(detailModulesShape);
export type SazuDetails = z.infer<typeof detailModulesSchema>;
export type DetailedPillar = z.infer<typeof detailedPillarSchema>;

// Preserve the complete returned modules for editorial work; omit request input and credentials.
export const providerDataSchema = z
  .object({
    topics: z.array(z.enum(["manse", "life"])).max(2),
    modules: z.record(z.string().max(80), z.json()),
    glossary: z.record(z.string().max(80), z.string().max(2000)),
  })
  .refine(
    (value) => JSON.stringify(value).length <= 250000,
    "Provider payload too large",
  );
export type ProviderData = z.infer<typeof providerDataSchema>;

import { z } from "zod";

const element = z.enum(["목", "화", "토", "금", "수"]);
export const hanjaSchema = z.object({
  id: z.string().min(1).max(80),
  reading: z.string().regex(/^[가-힣]$/),
  character: z.string().min(1).max(4),
  meaning: z.string().min(1).max(100),
  meanings: z.array(z.string().min(1).max(100)).max(100).optional(),
  meaningStatus: z.enum(["sourced", "unavailable"]).optional(),
  meaningSource: z.url().startsWith("https://").nullable().optional(),
  readingSource: z.url().startsWith("https://").optional(),
  strokeBasis: z.literal("written").optional(),
  searchAliases: z.array(z.string().min(1).max(100)).max(100).optional(),
  strokes: z.number().int().positive().max(100),
  element: element.nullable(),
  isBulyong: z.boolean().nullable(),
  dictionaryStrokes: z.number().int().positive().max(100).nullable(),
  strokeReview: z.enum(["unreviewed", "reference-checked"]),
  strokeSources: z
    .array(
      z.object({
        title: z.string().max(150),
        url: z.url().refine((value) => value.startsWith("https://")),
        basis: z.enum(["dictionary", "naming-original"]),
      }),
    )
    .max(10),
}).superRefine((item, ctx) => {
  if (item.strokeBasis === "written" && (item.dictionaryStrokes === null || item.strokes !== item.dictionaryStrokes))
    ctx.addIssue({ code: "custom", message: "Written stroke values must agree" });
  if (item.meaningStatus === "sourced" && (!item.meanings?.length || !item.meaningSource || item.meaning !== item.meanings[0]))
    ctx.addIssue({ code: "custom", message: "Sourced meaning requires matching primary gloss and source" });
  if (item.meaningStatus === "unavailable" && (item.meaning !== "뜻 확인 중" || item.meanings?.length !== 0 || item.meaningSource !== null))
    ctx.addIssue({ code: "custom", message: "Unavailable meaning must not contain inferred glosses" });
});
export const catalogSchema = z.object({
  status: z.enum(["preview", "verified"]),
  version: z.string().min(1).max(100),
});
export const hanjaResponseSchema = z.object({
  data: z.array(hanjaSchema).max(2000),
  catalog: catalogSchema,
});
export const nameResponseSchema = z.object({
  data: z.object({
    name: z.string().regex(/^[가-힣]{3}$/),
    hanja: z.array(hanjaSchema).length(3),
    grids: z
      .array(
        z.object({
          label: z.string().max(20),
          period: z.string().max(20),
          total: z.number().int().positive(),
          number: z.number().int().min(1).max(81),
          title: z.string().max(100),
          fortune: z.string().max(20),
          description: z.string().max(4000),
        }),
      )
      .length(4),
    sounds: z
      .array(
        z.object({
          syllable: z.string().length(1),
          element: element.nullable(),
        }),
      )
      .length(3),
    relations: z.array(z.string().max(100)).length(2),
  }),
  catalog: catalogSchema,
});
export const previewCatalog = {
  status: "preview" as const,
  version: "preview-2026-10-30",
};

import { z } from "zod";
import { nameResponseSchema } from "@/lib/name-contract";
import { modulesSchema } from "@/lib/sazu/schema";
export const PROMPT_VERSION = "reading-text-v1-2026-10-30";
export const contentSchema = z
  .object({
    title: z.string().min(1).max(100),
    summary: z.string().min(1).max(3000),
    sections: z
      .array(
        z
          .object({
            heading: z.string().min(1).max(100),
            body: z.string().min(1).max(6000),
          })
          .strict(),
      )
      .min(1)
      .max(12),
  })
  .strict()
  .refine(
    (v) => !/<\/?[a-z][^>]*>/i.test(JSON.stringify(v)),
    "HTML은 지원하지 않습니다.",
  );
export const snapshotSchema = z
  .object({
    version: z.literal(1),
    name: nameResponseSchema,
    sazu: z
      .object({
        source: z.literal("SAZU"),
        sandbox: z.literal(false),
        version: z.string(),
        modules: modulesSchema,
      })
      .nullable(),
    model: z.string().min(1),
    promptVersion: z.literal(PROMPT_VERSION),
    suriVersion: z.string(),
    sazuVersion: z.string(),
  })
  .refine(
    (s) =>
      s.name.catalog.status === "verified" &&
      s.name.data.hanja.every(
        (h) =>
          h.strokeReview === "reference-checked" &&
          h.strokeSources.some((source) => source.basis === "naming-original"),
      ),
    "검수된 스냅샷이 필요합니다.",
  );
export type Content = z.infer<typeof contentSchema>;
export type Snapshot = z.infer<typeof snapshotSchema>;

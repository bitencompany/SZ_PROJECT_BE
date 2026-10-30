import { z } from "zod";
import { birthSchema, type BirthInput } from "@/lib/sazu/schema";
import { nameInput } from "./catalog";
const birthForm = z
  .object({
    birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    birthTime: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .nullable(),
    gender: z.enum(["male", "female"]),
    birthCity: z.string().trim().min(1).max(40),
    consent: z.literal(true),
  })
  .strict();
export function toBirth(b: z.infer<typeof birthForm>): BirthInput {
  const [birthYear, birthMonth, birthDay] = b.birthDate.split("-").map(Number);
  const [birthHour, birthMinute] = b.birthTime?.split(":").map(Number) ?? [
    null,
    0,
  ];
  return birthSchema.parse({
    birthYear,
    birthMonth,
    birthDay,
    birthHour,
    birthMinute,
    isFemale: b.gender === "female",
    isLunar: false,
    isLeapMonth: false,
    birthCity: b.birthCity,
    trueSolarTime: false,
  });
}
export const storedInput = nameInput
  .extend({ birth: birthForm.nullable() })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.birth &&
      !birthSchema.safeParse(
        (() => {
          try {
            return toBirth(value.birth);
          } catch {
            return null;
          }
        })(),
      ).success
    )
      ctx.addIssue({
        code: "custom",
        message: "출생 정보 오류",
        path: ["birth"],
      });
  });
export const readingRequestInput = storedInput.safeExtend({
  requestId: z.uuid(),
  consentToSave: z.literal(true),
  previewId: z.uuid().optional(),
});
export const previewInput = z
  .object({ birth: birthSchema, consent: z.literal(true) })
  .strict()
  .superRefine((v, ctx) => {
    if (v.birth.isLunar || v.birth.isLeapMonth || v.birth.trueSolarTime)
      ctx.addIssue({
        code: "custom",
        message: "미리보기는 양력 표준시만 지원합니다.",
      });
  });
export type StoredInput = z.infer<typeof storedInput>;

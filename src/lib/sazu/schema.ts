import { z } from "zod";
import {
  detailedPillarSchema,
  detailModulesShape,
  type ProviderData,
} from "./details";

export function todayInSeoul(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function dateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export const birthSchema = z
  .object({
    birthYear: z.number().int().min(1900).max(2100),
    birthMonth: z.number().int().min(1).max(12),
    birthDay: z.number().int().min(1).max(31),
    birthHour: z.number().int().min(0).max(23).nullable(),
    birthMinute: z.number().int().min(0).max(59),
    isFemale: z.boolean(),
    isLunar: z.boolean(),
    isLeapMonth: z.boolean(),
    birthCity: z.string().trim().min(1).max(40),
    trueSolarTime: z.boolean(),
  })
  .strict()
  .superRefine((birth, ctx): void => {
    const issue = (message: string, field: string): void => {
      ctx.addIssue({ code: "custom", message, path: [field] });
    };
    if (birth.isLeapMonth && !birth.isLunar)
      issue("윤달은 음력 날짜에서만 선택할 수 있어요.", "isLeapMonth");
    if (birth.birthHour === null && birth.birthMinute !== 0)
      issue("태어난 시간을 모르면 분도 비워주세요.", "birthMinute");
    // 음력 2월 30일을 양력 Date로 검사하면 정상 날짜도 탈락하므로, 정확한 음력 검증은 서버의 SAZU 변환에 맡깁니다.
    if (birth.isLunar) {
      if (birth.birthDay > 30)
        issue("음력 날짜는 30일까지 입력할 수 있어요.", "birthDay");
    } else {
      const date: Date = new Date(
        Date.UTC(birth.birthYear, birth.birthMonth - 1, birth.birthDay),
      );
      if (
        date.getUTCMonth() !== birth.birthMonth - 1 ||
        date.getUTCDate() !== birth.birthDay
      )
        issue("존재하지 않는 날짜예요. 생년월일을 확인해 주세요.", "birthDay");
      if (
        dateKey(birth.birthYear, birth.birthMonth, birth.birthDay) >
        todayInSeoul()
      )
        issue("생년월일은 오늘 이전 날짜로 입력해 주세요.", "birthYear");
    }
  });

export type BirthInput = z.infer<typeof birthSchema>;

const pillarSchema = detailedPillarSchema;

// 외부 응답은 런타임에서도 검증하고, UI에서 사용하는 항목만 반환합니다.
export const modulesSchema = z.object({
  fourPillars: z.object({
    year: pillarSchema,
    month: pillarSchema,
    day: pillarSchema,
    hour: pillarSchema.nullable().optional(),
  }),
  elements: z
    .record(
      z.string(),
      z.object({
        name: z.string(),
        total: z.object({ count: z.number().nonnegative() }),
      }),
    )
    .optional(),
  ...detailModulesShape,
});

export type AnalysisModules = z.infer<typeof modulesSchema>;
export interface AnalysisResult {
  modules: AnalysisModules;
  providerData?: ProviderData;
  source: "SAZU";
  sandbox: boolean;
}
export type AnalysisResponse =
  | { success: true; data: AnalysisResult }
  | { success: false; error: { code: string; message: string } };

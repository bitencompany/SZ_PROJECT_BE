import "server-only";
import { SazuApiError, SazuClient } from "@sazuapp/client";
import {
  dateKey,
  modulesSchema,
  todayInSeoul,
  type AnalysisResult,
  type BirthInput,
} from "./schema";

export class AnalysisError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function analyzeBirth(birth: BirthInput): Promise<AnalysisResult> {
  const apiKey: string | undefined = process.env.SAZU_API_KEY?.trim();
  if (!apiKey)
    throw new AnalysisError(
      503,
      "NOT_CONFIGURED",
      "사주 분석 서비스를 준비하고 있어요. 잠시 후 다시 이용해 주세요.",
    );

  const client: SazuClient = new SazuClient({
    apiKey,
    timeoutMs: 15_000,
    maxRetries: 0,
  });
  try {
    if (birth.isLunar) {
      // 윤달과 음력 날짜를 직접 계산하지 않고 SAZU로 검증한 뒤, 변환된 양력 기준으로 미래 출생을 차단합니다.
      const converted = await client.calendar.convert({
        year: birth.birthYear,
        month: birth.birthMonth,
        day: birth.birthDay,
        direction: "toSolar",
        isLeapMonth: birth.isLeapMonth,
      });
      const { year, month, day } = converted.result;
      if (
        !Number.isInteger(year) ||
        !Number.isInteger(month) ||
        !Number.isInteger(day)
      )
        throw new AnalysisError(
          502,
          "INVALID_RESPONSE",
          "분석 응답을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.",
        );
      if (dateKey(year, month, day) > todayInSeoul())
        throw new AnalysisError(
          400,
          "INVALID_DATE",
          "생년월일은 오늘 이전 날짜로 입력해 주세요.",
        );
    }
    const reading = await client.readings.manse({
      ...birth,
      locale: "ko",
      detail: "standard",
    });
    const parsed = modulesSchema.safeParse(reading.modules);
    if (!parsed.success)
      throw new AnalysisError(
        502,
        "INVALID_RESPONSE",
        "분석 응답을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.",
      );
    return {
      modules: parsed.data,
      source: "SAZU",
      sandbox: apiKey.startsWith("sazu_free_"),
    };
  } catch (error: unknown) {
    if (error instanceof AnalysisError) throw error;
    if (error instanceof SazuApiError) {
      if (error.code === "SAMPLE_PROFILE_REQUIRED")
        throw new AnalysisError(
          400,
          "SAMPLE_PROFILE_REQUIRED",
          "현재는 샘플 조회만 가능해요. 샘플 입력을 이용해 주세요.",
        );
      if (error.isQuotaExhausted || error.isAuthError || error.isPlanRestricted)
        throw new AnalysisError(
          503,
          "SERVICE_UNAVAILABLE",
          "현재 사주 분석을 이용할 수 없어요. 서비스 관리자에게 문의해 주세요.",
        );
      if (error.isRateLimited)
        throw new AnalysisError(
          429,
          "RATE_LIMITED",
          "분석 요청이 많아요. 1분 후 다시 시도해 주세요.",
        );
      if (error.status === 400 || error.status === 422)
        throw new AnalysisError(
          400,
          "INVALID_INPUT",
          "생년월일과 출생 도시를 다시 확인해 주세요.",
        );
      if (error.status === 0)
        throw new AnalysisError(
          504,
          "UPSTREAM_TIMEOUT",
          "분석 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.",
        );
    }
    // 공급자의 오류 원문에는 요청 정보 등이 포함될 수 있으므로 그대로 노출하거나 기록하지 않습니다.
    throw new AnalysisError(
      502,
      "UPSTREAM_ERROR",
      "분석을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.",
    );
  }
}

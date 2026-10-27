import { NextResponse } from "next/server";
import { analyzeBirth, AnalysisError } from "@/lib/sazu/client";
import { birthSchema, type AnalysisResponse } from "@/lib/sazu/schema";

export const runtime = "nodejs";
export const maxDuration = 60;

function reply(
  body: AnalysisResponse,
  status: number,
): NextResponse<AnalysisResponse> {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store, private" },
  });
}
function failure(
  status: number,
  code: string,
  message: string,
): NextResponse<AnalysisResponse> {
  return reply({ success: false, error: { code, message } }, status);
}

export async function POST(
  request: Request,
): Promise<NextResponse<AnalysisResponse>> {
  // 결제 승인·주문 소유권을 서버에서 확인하기 전에는 운영 환경에 유료 API를 공개하지 않습니다.
  // 이후 이 분기를 DB의 승인된 주문 조회로 대체해야 하며, 클라이언트의 paid 값은 신뢰하면 안 됩니다.
  if (process.env.NODE_ENV === "production")
    return failure(503, "PAYMENT_NOT_READY", "서비스 오픈을 준비하고 있어요.");
  const origin: string | null = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    return failure(403, "FORBIDDEN_ORIGIN", "허용되지 않은 요청이에요.");
  if (
    request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !==
    "application/json"
  )
    return failure(
      415,
      "INVALID_CONTENT_TYPE",
      "올바른 형식으로 정보를 보내주세요.",
    );

  try {
    // Content-Length는 위조/생략할 수 있어 실제 읽은 바이트에도 상한을 적용합니다.
    const reader = request.body?.getReader();
    if (!reader)
      return failure(400, "INVALID_JSON", "입력 정보를 확인해 주세요.");
    const decoder: TextDecoder = new TextDecoder();
    let raw: string = "";
    let size: number = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 4096) {
          await reader.cancel();
          return failure(413, "BODY_TOO_LARGE", "입력 내용이 너무 길어요.");
        }
        raw += decoder.decode(value, { stream: true });
      }
      raw += decoder.decode();
    } finally {
      reader.releaseLock();
    }
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      return failure(400, "INVALID_JSON", "입력 정보를 확인해 주세요.");
    }
    const parsed = birthSchema.safeParse(payload);
    if (!parsed.success)
      return failure(
        400,
        "INVALID_INPUT",
        "생년월일·성별·출생 시간을 다시 확인해 주세요.",
      );
    const result = await analyzeBirth(parsed.data);
    return reply({ success: true, data: result }, 200);
  } catch (error: unknown) {
    if (error instanceof AnalysisError)
      return failure(error.status, error.code, error.message);
    return failure(
      500,
      "INTERNAL_ERROR",
      "요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.",
    );
  }
}

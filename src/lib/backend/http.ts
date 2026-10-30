import { z } from "zod";
import { AnalysisError } from "@/lib/sazu/client";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message = "요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.",
  ) {
    super(message);
  }
}
export function fail(status: number, code: string, message?: string): never {
  throw new ApiError(status, code, message);
}
export function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store, private" },
  });
}
export async function endpoint(
  action: () => Promise<unknown>,
): Promise<Response> {
  try {
    return json(await action());
  } catch (error) {
    const known = error instanceof ApiError || error instanceof AnalysisError;
    const status = known
      ? error.status
      : error instanceof z.ZodError
        ? 400
        : 500;
    const code = known
      ? error.code
      : error instanceof z.ZodError
        ? "INVALID_INPUT"
        : "INTERNAL_ERROR";
    const response = json(
      {
        success: false,
        error: {
          code,
          message: known
            ? error.message
            : status === 400
              ? "입력 정보를 확인해 주세요."
              : "요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.",
        },
      },
      status,
    );
    if (status === 429) response.headers.set("Retry-After", "60");
    return response;
  }
}
export async function body<T>(
  request: Request,
  schema: z.ZodType<T>,
  limit = 4096,
): Promise<T> {
  if (
    request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !==
    "application/json"
  )
    fail(415, "INVALID_CONTENT_TYPE");
  const reader = request.body?.getReader();
  if (!reader) fail(400, "INVALID_JSON");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        fail(413, "BODY_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  let value: unknown;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    fail(400, "INVALID_JSON");
  }
  return schema.parse(value);
}
export const uuid = z.uuid();
export function requiredEnv(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) fail(503, "NOT_CONFIGURED", "서비스 설정을 준비하고 있어요.");
  return value;
}

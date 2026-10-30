import { endpoint } from "@/lib/backend/http";
import { database } from "@/lib/backend/db";
export const runtime = "nodejs";
export const maxDuration = 60;
import { visitor } from "@/lib/backend/security";
import { visitorLimits } from "@/lib/backend/limits";
import { body } from "@/lib/backend/http";
import { previewInput } from "@/lib/backend/inputs";
import { createPreview } from "@/lib/backend/preview";
export async function POST(request: Request) {
  return endpoint(async () => {
    const who = visitor(request);
    const input = await body(request, previewInput);
    const db = database();
    await visitorLimits(db, who);
    const result = await createPreview(db, input.birth);
    return {
      success: true,
      data: {
        ...result.result,
        previewId: result.id,
        expiresAt: new Date(result.expires_at).toISOString(),
        providerVersion: result.provider_version,
      },
    };
  });
}

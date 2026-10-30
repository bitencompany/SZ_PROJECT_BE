import { endpoint } from "@/lib/backend/http";
import { database } from "@/lib/backend/db";
export const runtime = "nodejs";
export const maxDuration = 60;
import { user } from "@/lib/backend/security";
import { uuid } from "@/lib/backend/http";
import { retryGeneration } from "@/lib/backend/generation";
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  return endpoint(async () => {
    const userId = await user(request);
    const id = uuid.parse((await ctx.params).id);
    return retryGeneration(database(), userId, id);
  });
}

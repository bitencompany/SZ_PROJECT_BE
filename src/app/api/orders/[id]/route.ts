import { endpoint } from "@/lib/backend/http";
import { database } from "@/lib/backend/db";
export const runtime = "nodejs";
export const maxDuration = 60;
import { user } from "@/lib/backend/security";
import { uuid } from "@/lib/backend/http";
import { orderStatus } from "@/lib/backend/payments";
export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  return endpoint(async () => {
    const userId = await user(request);
    const id = uuid.parse((await ctx.params).id);
    return orderStatus(database(), userId, id);
  });
}

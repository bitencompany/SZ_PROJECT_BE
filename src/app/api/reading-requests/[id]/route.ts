import { endpoint } from "@/lib/backend/http";
import { database } from "@/lib/backend/db";
export const runtime = "nodejs";
export const maxDuration = 60;
import { user } from "@/lib/backend/security";
import { uuid } from "@/lib/backend/http";
import { getRequest, deleteRequest } from "@/lib/backend/requests";
export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  return endpoint(async () => {
    const userId = await user(request);
    const id = uuid.parse((await ctx.params).id);
    return getRequest(database(), userId, id);
  });
}
export async function DELETE(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  return endpoint(async () => {
    const userId = await user(request);
    const id = uuid.parse((await ctx.params).id);
    return deleteRequest(database(), userId, id);
  });
}

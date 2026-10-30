import { endpoint } from "@/lib/backend/http";
import { database } from "@/lib/backend/db";
export const runtime = "nodejs";
export const maxDuration = 60;
import { z } from "zod";
import { user } from "@/lib/backend/security";
import { listReadings } from "@/lib/backend/readings";
export async function GET(request: Request) {
  return endpoint(async () => {
    const userId = await user(request);
    const page = z.coerce
      .number()
      .int()
      .min(0)
      .max(10000)
      .parse(new URL(request.url).searchParams.get("page") ?? 0);
    return listReadings(database(), userId, page);
  });
}

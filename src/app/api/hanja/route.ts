import { endpoint } from "@/lib/backend/http";
import { database } from "@/lib/backend/db";
export const runtime = "nodejs";
export const maxDuration = 60;
import { z } from "zod";
import { findHanja } from "@/lib/backend/catalog";
import { bffAuth } from "@/lib/backend/security";
export async function GET(request: Request) {
  return endpoint(async () => {
    bffAuth(request);
    const query = z
      .object({
        reading: z.string().regex(/^[가-힣]$/),
        q: z.string().trim().max(40).default(""),
      })
      .strict()
      .parse(Object.fromEntries(new URL(request.url).searchParams));
    return findHanja(database(), query.reading, query.q);
  });
}

import { endpoint } from "@/lib/backend/http";
import { database } from "@/lib/backend/db";
export const runtime = "nodejs";
export const maxDuration = 60;
import { analyzeName, nameInput } from "@/lib/backend/catalog";
import { bffAuth } from "@/lib/backend/security";
import { body } from "@/lib/backend/http";
export async function POST(request: Request) {
  return endpoint(async () => {
    bffAuth(request);
    const input = await body(request, nameInput);
    return analyzeName(database(), input);
  });
}

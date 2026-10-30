import { endpoint } from "@/lib/backend/http";
import { database } from "@/lib/backend/db";
export const runtime = "nodejs";
export const maxDuration = 60;
import { user } from "@/lib/backend/security";
import { body } from "@/lib/backend/http";
import { readingRequestInput } from "@/lib/backend/inputs";
import { saveRequest } from "@/lib/backend/requests";
export async function POST(request: Request) {
  return endpoint(async () => {
    const userId = await user(request);
    const input = await body(request, readingRequestInput);
    return saveRequest(database(), userId, input);
  });
}

import { endpoint } from "@/lib/backend/http";
import { database } from "@/lib/backend/db";
export const runtime = "nodejs";
export const maxDuration = 60;
import { internalAuth, cronAuth } from "@/lib/backend/security";
import { runGeneration } from "@/lib/backend/generation";
export async function POST(request: Request) {
  return endpoint(async () => {
    internalAuth(request);
    return runGeneration(database());
  });
}

export async function GET(request: Request) {
  return endpoint(async () => {
    cronAuth(request);
    return runGeneration(database());
  });
}

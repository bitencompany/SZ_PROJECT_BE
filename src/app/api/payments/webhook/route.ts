import { endpoint } from "@/lib/backend/http";
import { database } from "@/lib/backend/db";
export const runtime = "nodejs";
export const maxDuration = 60;
import { paymentProvider, applyPayment } from "@/lib/backend/payments";
export async function POST(request: Request) {
  return endpoint(async () => {
    const provider = paymentProvider();
    const verified = await provider.verifyWebhook(request);
    return applyPayment(database(), verified);
  });
}

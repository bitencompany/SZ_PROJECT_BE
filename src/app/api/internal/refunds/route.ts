import { endpoint } from "@/lib/backend/http";
import { database } from "@/lib/backend/db";
export const runtime = "nodejs";
export const maxDuration = 60;
import { z } from "zod";
import { internalAuth } from "@/lib/backend/security";
import { body } from "@/lib/backend/http";
import { paymentProvider, refundPayment } from "@/lib/backend/payments";
export async function POST(request: Request) {
  return endpoint(async () => {
    internalAuth(request);
    const input = await body(request, z.object({ orderId: z.uuid() }).strict());
    const provider = paymentProvider();
    return refundPayment(database(), input.orderId, provider);
  });
}

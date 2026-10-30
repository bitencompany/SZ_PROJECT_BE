import { endpoint } from "@/lib/backend/http";
import { database } from "@/lib/backend/db";
export const runtime = "nodejs";
export const maxDuration = 60;
import { user } from "@/lib/backend/security";
import { body } from "@/lib/backend/http";
import {
  createOrder,
  orderInput,
  paymentProvider,
} from "@/lib/backend/payments";
export async function POST(request: Request) {
  return endpoint(async () => {
    const userId = await user(request);
    const input = await body(request, orderInput);
    const provider = paymentProvider();
    return createOrder(database(), userId, input, provider);
  });
}

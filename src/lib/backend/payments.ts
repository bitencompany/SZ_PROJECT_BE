import { z } from "zod";
import type { Queryable, Database } from "./db";
import { lock } from "./db";
import { fail } from "./http";
import { analyzeName } from "./catalog";
import { storedInput, toBirth } from "./inputs";
import { createPreview, matchingPreview, SAZU_VERSION } from "./preview";
import { consume } from "./limits";
import { PROMPT_VERSION } from "./generation-contract";

export const orderInput = z
  .object({
    requestId: z.uuid(),
    productCode: z.string().min(1).max(80),
    idempotencyKey: z.uuid(),
  })
  .strict();
export const confirmInput = z
  .object({ orderId: z.uuid(), paymentToken: z.string().min(1).max(500) })
  .strict();
export interface Order {
  id: string;
  user_id: string;
  request_id: string;
  product_code: string;
  amount: number;
  currency: string;
  status: string;
  provider_payment_id: string | null;
  payment_provider: string | null;
  generation_status: string | null;
}
// 이 타입은 PG 어댑터의 서버 검증 결과 전용입니다. HTTP 본문을 이 타입으로 캐스팅하지 마세요.
export interface VerifiedPayment {
  provider: string;
  eventId: string;
  orderId: string;
  paymentId: string;
  amount: number;
  currency: "KRW";
  state: "paid" | "cancelled" | "refunded";
}
export interface PaymentProvider {
  code: string;
  prepare(order: Order): Promise<Record<string, unknown>>;
  confirm(order: Order, token: string): Promise<VerifiedPayment>;
  verifyWebhook(request: Request): Promise<VerifiedPayment>;
  refund(order: Order): Promise<VerifiedPayment>;
}
// 사용자 결정(2026-10-30): PG 계약 전. 런타임 mock/환경변수 우회 경로를 두지 않습니다.
export function paymentProvider(): PaymentProvider {
  return fail(
    503,
    "PAYMENT_NOT_READY",
    "결제 서비스를 준비하고 있어요. 아직 결제되지 않았어요.",
  );
}
export async function ownedOrder(
  tx: Queryable,
  userId: string,
  id: string,
): Promise<Order> {
  const [row] = await tx.query<Order>(
    "select * from public.orders where id=$1 and user_id=$2",
    [id, userId],
  );
  if (!row) fail(404, "NOT_FOUND");
  return row;
}
export async function createOrder(
  db: Database,
  userId: string,
  input: z.infer<typeof orderInput>,
  provider: PaymentProvider,
) {
  await consume(db, `orders:${userId}`, 20, 3600);
  const sameOrder = async (tx: Queryable) => {
    const [same] = await tx.query<Order>(
      "select * from public.orders where user_id=$1 and idempotency_key=$2",
      [userId, input.idempotencyKey],
    );
    if (
      same &&
      (same.request_id !== input.requestId ||
        same.product_code !== input.productCode)
    )
      fail(409, "IDEMPOTENCY_CONFLICT");
    return same;
  };
  let order = await sameOrder(db);
  if (!order) {
    const [request] = await db.query<{ input: unknown; preview_id: string }>(
      `select r.input,m.preview_id from public.reading_requests r left join private.request_metadata m on m.request_id=r.id where r.id=$1 and r.user_id=$2`,
      [input.requestId, userId],
    );
    if (!request) fail(404, "NOT_FOUND");
    const normalized = storedInput.parse(request.input);
    const name = await analyzeName(
      db,
      { name: normalized.name, hanjaIds: normalized.hanjaIds },
      true,
    );
    const model = process.env.OPENAI_MODEL?.trim();
    if (!model || !process.env.OPENAI_API_KEY)
      fail(503, "GENERATION_NOT_READY");
    const available = await db.query(
      "select code from private.products where code=$1 and active=true",
      [input.productCode],
    );
    if (!available.length) fail(409, "PRODUCT_NOT_AVAILABLE");
    let sazu = null;
    // 외부 계산은 주문 트랜잭션을 열기 전에 완료합니다. 다른 연결을 중첩 대기하지 않습니다.
    if (normalized.birth) {
      const birth = toBirth(normalized.birth);
      const preview =
        (await matchingPreview(db, request.preview_id, birth)) ??
        (await createPreview(db, birth));
      if (preview.result.sandbox)
        fail(409, "SAMPLE_NOT_PAYABLE", "샘플 사주는 결제할 수 없어요.");
      sazu = { ...preview.result, version: preview.provider_version };
    }
    const evidence = await db.query<{ id: string; evidence: unknown }>(
      "select id,evidence from private.catalog_entries where version=$1 and id=any($2::text[])",
      [name.catalog.version, normalized.hanjaIds],
    );
    const snapshot = {
      version: 1,
      input: normalized,
      name,
      sazu,
      catalogEvidence: evidence,
      model,
      promptVersion: PROMPT_VERSION,
      sazuVersion: SAZU_VERSION,
      suriVersion: "fe-81-2026-10-30",
    };
    order = await db.transaction(async (tx) => {
      await lock(tx, `user:${userId}`);
      const same = await sameOrder(tx);
      if (same) return same;
      // 원본 입력은 불변이지만 사전 계산 중 삭제될 수 있으므로 소유권/존재를 다시 잠가 확인합니다.
      const exists = await tx.query(
        "select id from public.reading_requests where id=$1 and user_id=$2 for update",
        [input.requestId, userId],
      );
      if (!exists.length) fail(404, "NOT_FOUND");
      const previous = await tx.query(
        "select id from public.orders where request_id=$1 and status in ('pending','paid')",
        [input.requestId],
      );
      if (previous.length) fail(409, "ORDER_EXISTS");
      const [product] = await tx.query<{ amount: number; currency: string }>(
        "select amount,currency from private.products where code=$1 and active=true for share",
        [input.productCode],
      );
      if (!product) fail(409, "PRODUCT_NOT_AVAILABLE");
      const [created] = await tx.query<Order>(
        `insert into public.orders(user_id,request_id,amount,currency,product_code,idempotency_key,payment_provider) values($1,$2,$3,$4,$5,$6,$7) returning *`,
        [
          userId,
          input.requestId,
          product.amount,
          product.currency,
          input.productCode,
          input.idempotencyKey,
          provider.code,
        ],
      );
      await tx.query(
        "insert into private.order_snapshots(order_id,snapshot) values($1,$2::text::jsonb)",
        [created.id, JSON.stringify(snapshot)],
      );
      return created;
    });
  }
  return {
    data: {
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      status: order.status,
      payment:
        order.status === "pending" ? await provider.prepare(order) : null,
    },
  };
}
export async function applyPayment(db: Database, payment: VerifiedPayment) {
  return db.transaction((tx) => applyPaymentInTransaction(tx, payment));
}
async function applyPaymentInTransaction(
  tx: Queryable,
  payment: VerifiedPayment,
) {
  await lock(tx, `payment:${payment.orderId}`);
  const [order] = await tx.query<Order>(
    "select * from public.orders where id=$1 for update",
    [payment.orderId],
  );
  if (!order) fail(404, "NOT_FOUND");
  if (
    order.payment_provider !== payment.provider ||
    order.amount !== payment.amount ||
    order.currency !== payment.currency ||
    (order.provider_payment_id &&
      order.provider_payment_id !== payment.paymentId)
  )
    fail(409, "PAYMENT_MISMATCH");
  const [existing] = await tx.query<{ order_id: string; state: string }>(
    "select order_id,state from private.payment_events where provider=$1 and event_id=$2",
    [payment.provider, payment.eventId],
  );
  if (existing) {
    if (existing.order_id !== order.id || existing.state !== payment.state)
      fail(409, "EVENT_CONFLICT");
    return { data: { orderId: order.id, status: order.status } };
  }
  // 취소/환불은 terminal. 늦게 도착한 paid 이벤트로 접근 권한을 되살리지 않습니다.
  const terminal = ["cancelled", "refunded"].includes(order.status);
  if (payment.state === "paid" && !terminal) {
    const snapshots = await tx.query(
      "select order_id from private.order_snapshots where order_id=$1",
      [order.id],
    );
    if (!snapshots.length) fail(409, "SNAPSHOT_REQUIRED");
    await tx.query(
      "update public.orders set status='paid',provider_payment_id=$2,paid_at=coalesce(paid_at,now()),generation_status=coalesce(generation_status,'queued') where id=$1",
      [order.id, payment.paymentId],
    );
    await tx.query(
      "insert into private.generation_jobs(order_id) values($1) on conflict(order_id) do nothing",
      [order.id],
    );
  } else if (payment.state !== "paid") {
    const status = order.status === "refunded" ? "refunded" : payment.state;
    await tx.query(
      "update public.orders set status=$2,provider_payment_id=$3,generation_status=case when generation_status is null then null else 'failed' end where id=$1",
      [order.id, status, payment.paymentId],
    );
    await tx.query(
      "update private.generation_jobs set status='failed',lease_token=null,lease_until=null,last_error='PAYMENT_REVOKED' where order_id=$1",
      [order.id],
    );
  }
  await tx.query(
    "insert into private.payment_events(provider,event_id,order_id,state) values($1,$2,$3,$4)",
    [payment.provider, payment.eventId, order.id, payment.state],
  );
  const [updated] = await tx.query<{ status: string }>(
    "select status from public.orders where id=$1",
    [order.id],
  );
  return { data: { orderId: order.id, status: updated.status } };
}
export async function orderStatus(db: Database, userId: string, id: string) {
  const order = await ownedOrder(db, userId, id);
  const [reading] = await db.query<{ id: string }>(
    "select id from public.readings where order_id=$1 and user_id=$2",
    [id, userId],
  );
  return {
    data: {
      orderId: id,
      status: order.status,
      amount: order.amount,
      currency: order.currency,
      generationStatus: order.generation_status,
      readingId: order.status === "paid" ? (reading?.id ?? null) : null,
    },
  };
}

export async function confirmPayment(
  db: Database,
  userId: string,
  input: z.infer<typeof confirmInput>,
  provider: PaymentProvider,
) {
  return db.transaction(async (tx) => {
    await lock(tx, `payment:${input.orderId}`);
    const order = await ownedOrder(tx, userId, input.orderId);
    if (order.status === "paid")
      return { data: { orderId: order.id, status: order.status } };
    if (order.status !== "pending") fail(409, "ORDER_NOT_PAYABLE");
    // 어댑터는 승인 전 PG 조회, 주문/금액/통화/상태 검증, PG 멱등성을 보장해야 합니다.
    const verified = await provider.confirm(order, input.paymentToken);
    if (
      verified.orderId !== order.id ||
      verified.provider !== provider.code ||
      verified.state !== "paid"
    )
      fail(409, "PAYMENT_MISMATCH");
    return applyPaymentInTransaction(tx, verified);
  });
}
export async function refundPayment(
  db: Database,
  id: string,
  provider: PaymentProvider,
) {
  return db.transaction(async (tx) => {
    await lock(tx, `payment:${id}`);
    const [order] = await tx.query<Order>(
      "select * from public.orders where id=$1 for update",
      [id],
    );
    if (!order) fail(404, "NOT_FOUND");
    if (["cancelled", "refunded"].includes(order.status))
      return { data: { orderId: id, status: order.status } };
    if (order.status !== "paid") fail(409, "PAYMENT_REQUIRED");
    const verified = await provider.refund(order);
    if (
      verified.orderId !== id ||
      verified.provider !== provider.code ||
      verified.state === "paid"
    )
      fail(409, "PAYMENT_MISMATCH");
    return applyPaymentInTransaction(tx, verified);
  });
}

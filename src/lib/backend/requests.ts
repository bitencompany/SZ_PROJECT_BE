import { z } from "zod";
import type { Database } from "./db";
import { lock } from "./db";
import { activeCatalog } from "./catalog";
import { readingRequestInput, storedInput, toBirth } from "./inputs";
import { digest } from "./security";
import { ApiError, fail } from "./http";
import { matchingPreview } from "./preview";
import { consume } from "./limits";
export async function saveRequest(
  db: Database,
  userId: string,
  value: z.infer<typeof readingRequestInput>,
) {
  const input = storedInput.parse({
    name: value.name,
    hanjaIds: value.hanjaIds,
    birth: value.birth,
  });
  const hash = digest("reading-v1", input);
  // 빈도 제한은 멱등 재전송에도 적용합니다. 저장 건수는 새 요청에만 적용합니다.
  await consume(db, `save:${userId}`, 30, 3600);
  return db.transaction(async (tx) => {
    await lock(tx, `user:${userId}`);
    await lock(tx, `request:${value.requestId}`);
    const [existing] = await tx.query<{ user_id: string; input: unknown }>(
      "select user_id,input from public.reading_requests where id=$1",
      [value.requestId],
    );
    if (existing) {
      if (existing.user_id !== userId) fail(404, "NOT_FOUND");
      if (digest("reading-v1", storedInput.parse(existing.input)) !== hash)
        fail(
          409,
          "REQUEST_CONFLICT",
          "같은 요청 ID의 입력은 변경할 수 없어요.",
        );
      return { data: { requestId: value.requestId, paymentAvailable: false } };
    }
    const [{ count }] = await tx.query<{ count: number }>(
      "select count(*)::int as count from public.reading_requests where user_id=$1",
      [userId],
    );
    if (count >= 100)
      fail(
        429,
        "REQUEST_LIMIT",
        "보관함의 요청을 삭제한 뒤 다시 시도해 주세요.",
      );
    const catalog = await activeCatalog(tx).catch((error) => {
      if (error instanceof ApiError && error.code === "CATALOG_NOT_READY")
        return { status: "preview", version: "not-loaded" };
      throw error;
    });
    const preview = input.birth
      ? await matchingPreview(tx, value.previewId, toBirth(input.birth))
      : undefined;
    await tx.query(
      `insert into public.reading_requests(id,user_id,input,catalog_status,catalog_version,consent_version) values($1,$2,$3::jsonb,$4,$5,'save-v1-2026-10-30')`,
      [
        value.requestId,
        userId,
        JSON.stringify(input),
        catalog.status,
        catalog.version,
      ],
    );
    await tx.query(
      "insert into private.request_metadata(request_id,input_hash,preview_id) values($1,$2,$3)",
      [value.requestId, hash, preview?.id ?? null],
    );
    return { data: { requestId: value.requestId, paymentAvailable: false } };
  });
}
export async function getRequest(db: Database, userId: string, id: string) {
  const [row] = await db.query(
    'select id as "requestId",input,created_at as "createdAt" from public.reading_requests where id=$1 and user_id=$2',
    [id, userId],
  );
  if (!row) fail(404, "NOT_FOUND");
  return { data: row };
}
export async function deleteRequest(db: Database, userId: string, id: string) {
  return db.transaction(async (tx) => {
    await lock(tx, `user:${userId}`);
    const [row] = await tx.query(
      "select id from public.reading_requests where id=$1 and user_id=$2 for update",
      [id, userId],
    );
    if (!row) fail(404, "NOT_FOUND");
    const orders = await tx.query(
      "select id from public.orders where request_id=$1",
      [id],
    );
    if (orders.length)
      fail(
        409,
        "ORDER_LINKED_REQUEST",
        "주문에 연결된 요청은 고객 지원을 통해 삭제해 주세요.",
      );
    await tx.query("delete from public.reading_requests where id=$1", [id]);
    return { data: { deleted: true } };
  });
}

import type { Database } from "./db";
import { fail } from "./http";
export async function getReading(db: Database, userId: string, id: string) {
  const [row] = await db.query(
    `select r.id,r.subject_name as "subjectName",r.content,r.created_at as "createdAt",r.provenance from public.readings r join public.orders o on o.id=r.order_id and o.user_id=r.user_id where r.id=$1 and r.user_id=$2 and o.status='paid'`,
    [id, userId],
  );
  if (!row) fail(404, "NOT_FOUND");
  return { data: row };
}
export async function listReadings(db: Database, userId: string, page: number) {
  const rows = await db.query(
    `select r.id,r.subject_name as "subjectName",r.created_at as "createdAt",r.content->>'title' as title from public.readings r join public.orders o on o.id=r.order_id and o.user_id=r.user_id where r.user_id=$1 and o.status='paid' order by r.created_at desc,r.id desc limit 21 offset $2`,
    [userId, page * 20],
  );
  return {
    data: rows.slice(0, 20),
    nextPage: rows.length > 20 ? page + 1 : null,
  };
}
export async function cleanup(db: Database) {
  return db.transaction(async (tx) => {
    const previews = await tx.query(
      "delete from private.previews where expires_at<now() returning id",
    );
    await tx.query(
      "delete from private.usage_limits where expires_at<now()-interval '1 day'",
    );
    const requests = await tx.query(
      `delete from public.reading_requests r where r.created_at<now()-interval '30 days' and not exists(select 1 from public.orders o where o.request_id=r.id) returning id`,
    );
    return {
      data: {
        previewsDeleted: previews.length,
        requestsDeleted: requests.length,
      },
    };
  });
}

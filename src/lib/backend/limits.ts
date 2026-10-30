import type { Database } from "./db";
import { fail } from "./http";
export async function consume(
  db: Database,
  key: string,
  maximum: number,
  seconds: number,
): Promise<void> {
  const rows = await db.query<{ count: number }>(
    `insert into private.usage_limits(key, bucket, count, expires_at)
    values ($1, floor(extract(epoch from now()) / $2)::bigint, 1, now() + ($2 * interval '1 second'))
    on conflict(key, bucket) do update set count = usage_limits.count + 1 where usage_limits.count < $3 returning count`,
    [key, seconds, maximum],
  );
  if (!rows.length)
    fail(429, "RATE_LIMITED", "요청이 많아요. 잠시 후 다시 시도해 주세요.");
}
export async function visitorLimits(
  db: Database,
  who: { ip: string; session: string },
): Promise<void> {
  await consume(db, `preview-ip:${who.ip}`, 20, 3600);
  await consume(db, `preview-session:${who.session}`, 10, 3600);
}
export function positiveSetting(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1) fail(503, "NOT_CONFIGURED");
  return value;
}

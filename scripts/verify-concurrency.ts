import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import postgres from "postgres";
import type { Database, Queryable } from "../src/lib/backend/db";
import { consume } from "../src/lib/backend/limits";
import { ApiError } from "../src/lib/backend/http";

// 임시 사용량 키 하나를 생성·삭제합니다. 회원·주문·공급자는 건드리지 않습니다.
assert(process.env.DATABASE_URL, "DATABASE_URL 설정 필요");
const sql = postgres(process.env.DATABASE_URL, { max: 3, prepare: false, connect_timeout: 10, onnotice: () => {} });
const key = `verification:${randomUUID()}`;
let verified = false;
const db: Database = {
  query: (text, params) => db.transaction((tx) => tx.query(text, params)),
  async transaction<T>(fn: (tx: Queryable) => Promise<T>) {
    return await sql.begin(async (tx) => {
      await tx`set local role service_role`;
      await tx`set local lock_timeout = '5s'`;
      await tx`set local statement_timeout = '10s'`;
      return fn({ async query<R>(text: string, params: unknown[] = []) {
        return await tx.unsafe(text, params as postgres.ParameterOrJSON<never>[]) as unknown as R[];
      } });
    }) as T;
  },
};
try {
  await db.transaction(async (first) => {
    await first.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [key]);
    await db.transaction(async (second) => {
      const [row] = await second.query<{ acquired: boolean }>("select pg_try_advisory_xact_lock(hashtextextended($1,0)) as acquired", [key]);
      assert.equal(row.acquired, false);
    });
  });
  await db.transaction(async (tx) => {
    const [row] = await tx.query<{ acquired: boolean }>("select pg_try_advisory_xact_lock(hashtextextended($1,0)) as acquired", [key]);
    assert.equal(row.acquired, true);
  });
  // 자정/버킷 경계에서도 동일 버킷을 사용하도록 이 검증의 창은 충분히 길게 고정합니다.
  const results = await Promise.allSettled(Array.from({ length: 10 }, () => consume(db, key, 2, 2147483647)));
  assert.equal(results.filter((item) => item.status === "fulfilled").length, 2);
  assert(results.filter((item) => item.status === "rejected").every((item) => item.reason instanceof ApiError && item.reason.code === "RATE_LIMITED"));
  const [row] = await db.query<{ count: number }>("select count from private.usage_limits where key=$1", [key]);
  assert.equal(row.count, 2);
  verified = true;
} catch {
  console.error("동시성 검증 실패: 연결 수·잠금·사용량 제한을 확인하세요.");
  process.exitCode = 1;
} finally {
  try {
    await db.query("delete from private.usage_limits where key=$1", [key]);
    const [row] = await db.query<{ count: number }>("select count(*)::int as count from private.usage_limits where key=$1", [key]);
    assert.equal(row.count, 0);
    if (verified) {
      const report = { checkedAt: new Date().toISOString(), advisoryLockAcrossConnections: true, concurrentRequests: 10, accepted: 2, rateLimited: 8, temporaryRowsRemaining: 0 };
      await mkdir(".local/verification", { recursive: true });
      await writeFile(".local/verification/concurrency.json", JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
      console.log(JSON.stringify(report));
    }
  } catch {
    console.error("검증용 사용량 키 정리 확인 실패. verification: 접두사를 점검하세요.");
    process.exitCode = 1;
  }
  await sql.end();
}

import "server-only";
import postgres from "postgres";
import { requiredEnv } from "./http";
export interface Queryable {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
}
export interface Database extends Queryable {
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
}
let connection: postgres.Sql | undefined;
function wrap(sql: postgres.Sql | postgres.TransactionSql): Queryable {
  return {
    async query<T>(text: string, params: unknown[] = []) {
      return (await sql.unsafe(
        text,
        params as postgres.ParameterOrJSON<never>[],
      )) as unknown as T[];
    },
  };
}
export function database(): Database {
  connection ??= postgres(requiredEnv("DATABASE_URL"), {
    max: 5,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 20,
    onnotice: () => {},
  });
  const sql = connection;
  async function transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
    return (await sql.begin(async (tx) => {
      await tx.unsafe("set local role service_role");
      await tx.unsafe("set local lock_timeout = '20s'");
      await tx.unsafe("set local statement_timeout = '55s'");
      return fn(wrap(tx));
    })) as T;
  }
  return {
    transaction,
    query<T>(text: string, params: unknown[] = []): Promise<T[]> {
      return transaction((tx) => tx.query<T>(text, params));
    },
  };
}
export async function lock(tx: Queryable, key: string): Promise<void> {
  await tx.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [
    key,
  ]);
}

import { analyzeBirth } from "@/lib/sazu/client";
import type { AnalysisResult, BirthInput } from "@/lib/sazu/schema";
import { modulesSchema } from "@/lib/sazu/schema";
import type { Database, Queryable } from "./db";
import { lock } from "./db";
import { digest } from "./security";
import { consume, positiveSetting } from "./limits";
import { fail } from "./http";
export const SAZU_VERSION = "sazu-v2-manse-life-standard/sdk-0.10.1/preview-v2";
export interface Preview {
  id: string;
  result: AnalysisResult;
  expires_at: Date;
  provider_version: string;
}
export function previewFields(
  result: AnalysisResult,
  birth: BirthInput,
): AnalysisResult {
  const modules = modulesSchema.parse(result.modules);
  return {
    ...(birth.birthHour !== null && result.providerData
      ? { providerData: result.providerData }
      : {}),
    source: "SAZU",
    sandbox: result.sandbox,
    modules: {
      ...(birth.birthHour !== null ? modules : {}),
      fourPillars: {
        ...modules.fourPillars,
        ...(birth.birthHour === null ? { hour: null } : {}),
      },
    },
  };
}
export async function createPreview(
  db: Database,
  birth: BirthInput,
  analyze = (input: BirthInput) => analyzeBirth(input, true),
): Promise<Preview> {
  if (process.env.PREVIEW_ENABLED !== "true")
    fail(503, "PREVIEW_NOT_READY", "사주 미리보기를 준비하고 있어요.");
  const hash = digest("birth-v1", birth);
  const [existing] = await db.query<Preview>(
    "select * from private.previews where input_hash=$1 and expires_at>now() and jsonb_typeof(result)='object' and provider_version=$2",
    [hash, SAZU_VERSION],
  );
  if (existing) return existing;
  // 잠금을 기다리는 동안 다른 연결을 추가 요구하지 않습니다. 캐시 미스는 먼저 예산을
  // 예약하며, 동시 중복 요청의 예약은 보수적으로 소비될 수 있지만 공급자 호출은 합칩니다.
  // 별도 커밋이므로 공급자 실패로 이미 예약한 예산을 되돌리지 않습니다.
  await consume(
    db,
    "sazu-provider-daily",
    positiveSetting("SAZU_DAILY_CALL_BUDGET", 100),
    86400,
  );
  // The expanded preview makes two provider calls (manse + life).
  if (birth.birthHour !== null)
    await consume(
      db,
      "sazu-provider-daily",
      positiveSetting("SAZU_DAILY_CALL_BUDGET", 100),
      86400,
    );
  // 공유 DB 잠금이므로 여러 서버 인스턴스에서도 같은 입력을 한 번만 계산합니다.
  return db.transaction(async (tx) => {
    await lock(tx, `preview:${hash}`);
    const [cached] = await tx.query<Preview>(
      "select * from private.previews where input_hash=$1 and expires_at > now() and jsonb_typeof(result)='object' and provider_version=$2",
      [hash, SAZU_VERSION],
    );
    if (cached) return cached;
    const result = previewFields(await analyze(birth), birth);
    const [preview] = await tx.query<Preview>(
      // Serialized JSON must bind as text: postgres v4 otherwise serializes it a second time.
      `insert into private.previews(input_hash,result,provider_version,expires_at)
      values($1,$2::text::jsonb,$3,now()+interval '30 minutes')
      on conflict(input_hash) do update set id=gen_random_uuid(),result=excluded.result,provider_version=excluded.provider_version,expires_at=excluded.expires_at
      returning *`,
      [hash, JSON.stringify(result), SAZU_VERSION],
    );
    return preview;
  });
}
export async function matchingPreview(
  db: Queryable,
  previewId: string | undefined,
  birth: BirthInput,
): Promise<Preview | undefined> {
  if (!previewId) return undefined;
  const [row] = await db.query<Preview>(
    "select * from private.previews where id=$1 and input_hash=$2 and expires_at>now() and jsonb_typeof(result)='object' and provider_version=$3",
    [previewId, digest("birth-v1", birth), SAZU_VERSION],
  );
  return row;
}

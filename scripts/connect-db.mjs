import { readFile, writeFile, chmod } from "node:fs/promises";
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import postgres from "postgres";

// 기존 DB 비밀번호를 로컬에서만 입력받습니다. 원격 비밀번호를 변경하지 않습니다.
if (!process.stdin.isTTY || !process.stdout.isTTY) {
  console.error(
    "터미널에서 npm run db:connect를 실행하세요. 비밀번호를 인수로 전달하지 마세요.",
  );
  process.exit(1);
}
const project = new URL(process.env.SUPABASE_URL ?? "https://invalid.local")
  .hostname;
const host = process.env.SUPABASE_DB_POOLER_HOST;
if (
  !/^[a-z]{20}\.supabase\.co$/.test(project) ||
  !host ||
  !/^aws-\d+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(host)
) {
  console.error(
    ".env.local의 SUPABASE_URL과 SUPABASE_DB_POOLER_HOST를 먼저 설정하세요.",
  );
  process.exit(1);
}
console.log(`연결 대상: ${project} / ${host}:6543`);
process.stdout.write(
  "프로젝트 생성 시 지정한 DB 비밀번호 (화면에 표시되지 않음): ",
);
const hiddenOutput = new Writable({
  write(_chunk, _encoding, done) {
    done();
  },
});
const prompt = createInterface({
  input: process.stdin,
  output: hiddenOutput,
  terminal: true,
});
prompt.on("SIGINT", () => {
  prompt.close();
  process.stdout.write("\n취소했습니다.\n");
  process.exit(130);
});
let password = await new Promise((resolve) => prompt.question("", resolve));
prompt.close();
process.stdout.write("\n");
if (!password) {
  console.error("빈 비밀번호는 저장하지 않습니다.");
  process.exit(1);
}
// URL 사용자정보의 예약문자 및 dotenv의 $, # 해석을 방지합니다.
const encoded = encodeURIComponent(password).replace(
  /[!'()*]/g,
  (c) => `%${c.charCodeAt(0).toString(16)}`,
);
password = "";
const connection = `postgresql://postgres.${project.split(".")[0]}:${encoded}@${host}:6543/postgres?sslmode=require`;
const sql = postgres(connection, {
  max: 1,
  prepare: false,
  connect_timeout: 15,
  onnotice: () => {},
});
try {
  await sql.begin(async (tx) => {
    await tx`set local role service_role`;
    await tx`select 1`;
  });
  const file = new URL("../.env.local", import.meta.url);
  const original = await readFile(file, "utf8");
  if ((original.match(/^DATABASE_URL=/gm) ?? []).length > 1)
    throw new Error("DUPLICATE_DATABASE_URL");
  const value = `DATABASE_URL=${connection}`;
  const updated = /^DATABASE_URL=.*$/m.test(original)
    ? original.replace(/^DATABASE_URL=.*$/m, () => value)
    : `${original.trimEnd()}\n${value}\n`;
  await chmod(file, 0o600);
  await writeFile(file, updated, { mode: 0o600 });
  console.log(
    "TLS 연결과 BE 역할 전환 확인 완료. DATABASE_URL을 .env.local에 저장했습니다.",
  );
  console.log("다음 단계: npm run db:migrate -- --apply");
} catch {
  console.error(
    "연결 또는 로컬 저장에 실패했습니다. 네트워크·DB 비밀번호·파일 권한을 확인하세요. 비밀값과 오류 원문은 출력하지 않습니다.",
  );
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}

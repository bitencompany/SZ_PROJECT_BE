export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 배포 생존 확인 전용. 기능 준비 여부나 비밀 설정은 공개하지 않습니다.
export function GET() {
  return Response.json(
    { status: "ok", service: "sz-project-be" },
    { headers: { "Cache-Control": "no-store" } },
  );
}

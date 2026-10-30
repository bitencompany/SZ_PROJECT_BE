import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { fail, requiredEnv, uuid } from "./http";
export function equalSecret(a: string, b: string): boolean {
  return timingSafeEqual(
    createHash("sha256").update(a).digest(),
    createHash("sha256").update(b).digest(),
  );
}
export function internalAuth(request: Request): void {
  if (
    !equalSecret(
      request.headers.get("authorization") ?? "",
      `Bearer ${requiredEnv("WORKER_SECRET")}`,
    )
  )
    fail(401, "UNAUTHORIZED");
}
export function bffAuth(request: Request): void {
  if (
    !equalSecret(
      request.headers.get("x-bff-secret") ?? "",
      requiredEnv("BFF_SHARED_SECRET"),
    )
  )
    fail(403, "FORBIDDEN");
}
export function visitor(request: Request): { ip: string; session: string } {
  bffAuth(request);
  const ip = request.headers.get("x-client-ip") ?? "";
  const session = request.headers.get("x-anonymous-id") ?? "";
  if (!isIP(ip) || !uuid.safeParse(session).success)
    fail(400, "INVALID_VISITOR");
  return { ip: digest("ip", ip), session: digest("session", session) };
}
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export function digest(namespace: string, value: unknown): string {
  return createHmac("sha256", requiredEnv("INPUT_HASH_SECRET"))
    .update(`${namespace}:${stableJson(value)}`)
    .digest("hex");
}
let cached: { issuer: string; key: JWTVerifyGetKey } | undefined;
export async function verifyUser(
  token: string,
  issuer: string,
  key: JWTVerifyGetKey,
): Promise<string> {
  try {
    const { payload } = await jwtVerify(token, key, {
      issuer,
      audience: "authenticated",
      algorithms: ["ES256", "RS256"],
      requiredClaims: ["sub", "exp", "iat", "role"],
    });
    if (payload.role !== "authenticated" || payload.is_anonymous === true)
      fail(401, "UNAUTHORIZED");
    return uuid.parse(payload.sub);
  } catch {
    fail(401, "UNAUTHORIZED", "로그인이 필요해요. 다시 로그인해 주세요.");
  }
}
export async function user(request: Request): Promise<string> {
  bffAuth(request);
  const token = request.headers
    .get("authorization")
    ?.match(/^Bearer ([^\s]+)$/i)?.[1];
  if (!token || token.length > 8192) fail(401, "UNAUTHORIZED");
  const url = new URL(requiredEnv("SUPABASE_URL"));
  if (
    url.protocol !== "https:" &&
    !(
      process.env.NODE_ENV !== "production" &&
      ["localhost", "127.0.0.1"].includes(url.hostname)
    )
  )
    fail(503, "NOT_CONFIGURED");
  const issuer = `${url.origin}/auth/v1`;
  if (cached?.issuer !== issuer)
    cached = {
      issuer,
      key: createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`), {
        timeoutDuration: 5000,
        cacheMaxAge: 60_000,
      }),
    };
  return verifyUser(token, issuer, cached.key);
}

export function cronAuth(request: Request): void {
  if (
    !equalSecret(
      request.headers.get("authorization") ?? "",
      `Bearer ${requiredEnv("CRON_SECRET")}`,
    )
  )
    fail(401, "UNAUTHORIZED");
}

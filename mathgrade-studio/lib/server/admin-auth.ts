import { env } from "cloudflare:workers";
import { HttpError } from "./validation";
import { productSessionIdentity } from "./product-auth";

export type AdminActor = { id: string; name: string };

// Workers owners are pinned by stable account ID; Sites retains trusted ingress auth.
// Choosing a teacher role or sharing an email address never grants ownership.
export async function requireAdmin(request: Request): Promise<AdminActor> {
  const config = env as unknown as Record<string, unknown>;
  const origin = new URL(request.url).origin;
  if (config.DEPLOYMENT_TARGET === "cloudflare") {
    const allowedId = typeof config.ADMIN_OWNER_USER_ID === "string" ? config.ADMIN_OWNER_USER_ID.trim() : "";
    if (!allowedId || config.ADMIN_SITE_ORIGIN !== origin || !origin.startsWith("https://")) {
      throw new HttpError(403, "이 환경에서는 관리자 권한이 설정되어 있지 않습니다.", "ADMIN_NOT_CONFIGURED");
    }
    const user = await productSessionIdentity(request);
    if (!user) throw new HttpError(401, "관리자로 지정된 수식채점실 계정으로 로그인해 주세요.", "ADMIN_SIGN_IN_REQUIRED");
    if (user.id !== allowedId) throw new HttpError(403, "사이트 소유자만 관리자 화면에 접근할 수 있습니다.", "ADMIN_ACCESS_DENIED");
    if (request.method !== "GET" && request.headers.get("origin") !== origin) {
      throw new HttpError(403, "관리자 사이트에서 직접 요청해 주세요.", "ADMIN_ORIGIN_REQUIRED");
    }
    return { id: user.id, name: user.name.trim().slice(0, 100) || "사이트 소유자" };
  }
  const allowedEmail = typeof config.ADMIN_OWNER_EMAIL === "string"
    ? config.ADMIN_OWNER_EMAIL.trim().toLowerCase()
    : "";
  if (!allowedEmail || config.ADMIN_SITE_ORIGIN !== origin || !origin.startsWith("https://")) {
    throw new HttpError(403, "이 환경에서는 관리자 권한이 설정되어 있지 않습니다.", "ADMIN_NOT_CONFIGURED");
  }
  const id = request.headers.get("oai-authenticated-user-id")?.trim();
  const email = request.headers.get("oai-authenticated-user-email")?.trim().toLowerCase();
  if (!id || !email) {
    throw new HttpError(401, "관리자 ChatGPT 계정으로 로그인해 주세요.", "ADMIN_SIGN_IN_REQUIRED");
  }
  if (email !== allowedEmail) {
    throw new HttpError(403, "수식채점실 소유자만 관리자 화면에 접근할 수 있습니다.", "ADMIN_ACCESS_DENIED");
  }
  if (request.method !== "GET" && request.headers.get("origin") !== origin) {
    throw new HttpError(403, "관리자 사이트에서 직접 요청해 주세요.", "ADMIN_ORIGIN_REQUIRED");
  }
  let name = request.headers.get("oai-authenticated-user-full-name")?.trim() ?? "";
  if (request.headers.get("oai-authenticated-user-full-name-encoding") === "percent-encoded-utf-8") {
    try { name = decodeURIComponent(name); } catch { name = ""; }
  }
  return { id, name: name.trim().slice(0, 100) || "사이트 소유자" };
}

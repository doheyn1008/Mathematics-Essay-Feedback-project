import { env } from "cloudflare:workers";
import type { ProductUser } from "./product-auth";
import { HttpError } from "./validation";

/** Identity attached by the trusted Sites ingress. This does not start an app session. */
export function siteIngressIdentity(request: Request): ProductUser | null {
  const id = request.headers.get("oai-authenticated-user-id")?.trim();
  if (!id) return null;
  const email = request.headers.get("oai-authenticated-user-email")?.trim() ?? "";
  let name = request.headers.get("oai-authenticated-user-full-name") ?? "";
  if (request.headers.get("oai-authenticated-user-full-name-encoding") === "percent-encoded-utf-8") {
    try { name = decodeURIComponent(name); } catch { name = ""; }
  }
  return { id, email, name: name.trim() || email || "사용자" };
}

const hasExistingRecords = `
  EXISTS (SELECT 1 FROM product_profiles WHERE user_id = account.id)
  OR EXISTS (SELECT 1 FROM academies WHERE owner_id = account.id)
  OR EXISTS (SELECT 1 FROM memberships WHERE user_id = account.id)
  OR EXISTS (SELECT 1 FROM submissions WHERE student_id = account.id)
  OR EXISTS (SELECT 1 FROM questions WHERE owner_id = account.id)
  OR EXISTS (SELECT 1 FROM admission_records WHERE owner_id = account.id)
  OR EXISTS (SELECT 1 FROM product_submissions WHERE student_id = account.id)
  OR EXISTS (SELECT 1 FROM product_exams WHERE owner_id = account.id)
`;

async function eligibleSiteAccount(request: Request, db = env.DB): Promise<ProductUser | null> {
  const url = new URL(request.url);
  const config = env as unknown as Record<string, unknown>;
  if (!db || url.protocol !== "https:" || config.ADMIN_SITE_ORIGIN !== url.origin) return null;

  // The authenticated email establishes that this is a real ingress identity.
  // The stable Sites subject is the sole key for locating its historical records.
  const user = siteIngressIdentity(request);
  if (!user || !user.email.includes("@")) return null;
  const found = await db.prepare(`
    SELECT account.id FROM (SELECT ? AS id) account WHERE ${hasExistingRecords}
  `).bind(user.id).first<{ id: string }>();
  return found ? user : null;
}

export async function canContinueSiteAccount(request: Request): Promise<boolean> {
  return (await eligibleSiteAccount(request)) !== null;
}

export async function provisionSiteAccount(request: Request, db: D1Database): Promise<string> {
  const user = await eligibleSiteAccount(request, db);
  if (!user) {
    throw new HttpError(403, "현재 ChatGPT 계정에 연결된 기존 Q.E.D. 기록을 찾을 수 없습니다.", "LEGACY_SITE_ACCOUNT_UNAVAILABLE");
  }

  await db.prepare(`
    INSERT INTO product_users (id, name, email, created_at)
    SELECT account.id, COALESCE(NULLIF(p.display_name, ''), ?), ?, COALESCE(p.created_at, ?)
    FROM (SELECT ? AS id) account LEFT JOIN product_profiles p ON p.user_id = account.id
    WHERE ${hasExistingRecords}
    ON CONFLICT (id) DO NOTHING
  `).bind(user.name.slice(0, 80), user.email, new Date().toISOString(), user.id).run();
  return user.id;
}

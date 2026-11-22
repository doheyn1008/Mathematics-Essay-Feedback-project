import { env } from "cloudflare:workers";
import type { AccountMode, AccountType, ClassMember, Entitlement, Exam, OwnerAccess, Plan, ProductState, Profile } from "../product-types";
import { HttpError } from "./validation";

export type ProductUser = NonNullable<ProductState["user"]>;
export function productDatabase(): D1Database {
  if (!env.DB) throw new HttpError(503, "저장소 연결을 준비 중입니다.", "STORAGE_NOT_CONFIGURED");
  return env.DB;
}
/** Resolve only a stored app session, including expiry and account closure checks. */
export async function productSessionIdentity(request: Request): Promise<ProductUser | null> {
  const token = request.headers.get("cookie")?.match(/(?:^|;\s*)mg_session=([a-f0-9]{64})(?:;|$)/)?.[1];
  if (token && env.DB) {
    const hash = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))).toString("hex");
    const user = await env.DB.prepare("SELECT u.id, u.email, COALESCE(p.display_name,u.name) AS name FROM product_sessions s JOIN product_users u ON u.id = s.user_id LEFT JOIN product_profiles p ON p.user_id=u.id WHERE s.token_hash = ? AND s.expires_at > ? AND NOT EXISTS (SELECT 1 FROM product_closed_accounts c WHERE c.user_id=u.id)").bind(hash,new Date().toISOString()).first<ProductUser>();
    if (user) return user;
  }
  return null;
}
export async function productIdentity(request: Request): Promise<ProductUser | null> {
  const user = await productSessionIdentity(request);
  if (user) return user;
  // Optional legacy ingress identity must be explicitly enabled. Local Sites mock auth is never app login.
  const config = env as unknown as Record<string, unknown>;
  if (config.DEPLOYMENT_TARGET === "cloudflare" || config.PRODUCT_HOST_LOGIN !== "true") return null;
  const id = request.headers.get("oai-authenticated-user-id");
  if (!id) return null;
  if (env.DB && await env.DB.prepare("SELECT user_id FROM product_closed_accounts WHERE user_id=?").bind(id).first()) return null;
  const email = request.headers.get("oai-authenticated-user-email") || "";
  let name = request.headers.get("oai-authenticated-user-full-name") || "";
  if (request.headers.get("oai-authenticated-user-full-name-encoding") === "percent-encoded-utf-8") {
    try { name = decodeURIComponent(name); } catch { name = ""; }
  }
  return { id, email, name: name || email || "사용자" };
}
export async function requireProductUser(request: Request): Promise<ProductUser> {
  const user = await productIdentity(request);
  if (!user) throw new HttpError(401, "로그인 후 이용하세요.", "AUTH_REQUIRED");
  return user;
}
export function productJson(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
export function checkProductOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) throw new HttpError(403, "요청 출처를 확인할 수 없습니다.");
}
export async function readProductJson(request: Request): Promise<Record<string, unknown>> {
  if (Number(request.headers.get("content-length")) > 250000) throw new HttpError(413, "입력 내용이 너무 큽니다.");
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return body as Record<string, unknown>;
  } catch { throw new HttpError(400, "입력 내용을 확인하세요."); }
}
export async function getProfile(db: D1Database, userId: string): Promise<Profile | null> {
  return db.prepare("SELECT user_id AS userId, account_type AS accountType, display_name AS displayName, created_at AS createdAt FROM product_profiles WHERE user_id = ?").bind(userId).first<Profile>();
}
/** A server-configured Workers owner, never a role, email or browser-supplied flag. */
export function isOwnerAccount(userId: string): boolean {
  const config = env as unknown as Record<string, unknown>;
  return config.DEPLOYMENT_TARGET === "cloudflare" && typeof config.ADMIN_OWNER_USER_ID === "string"
    && Boolean(config.ADMIN_OWNER_USER_ID.trim()) && config.ADMIN_OWNER_USER_ID.trim() === userId;
}
export async function ownerAccess(db: D1Database, userId: string): Promise<OwnerAccess | undefined> {
  if (!isOwnerAccount(userId)) return undefined;
  if (await db.prepare("SELECT user_id FROM product_closed_accounts WHERE user_id=?").bind(userId).first()) return undefined;
  const profile = await getProfile(db, userId);
  if (!profile) return undefined;
  const stored = await db.prepare("SELECT mode FROM product_owner_modes WHERE user_id=?").bind(userId).first<{mode:AccountMode}>();
  const mode = profile.accountType === "personal"
    ? stored?.mode === "personal_basic" ? "personal_basic" : "personal_premium"
    : profile.accountType;
  return { mode };
}
export function ownerEntitlement(userId: string, plan: Plan): Entitlement {
  return { userId, plan, status: "active", expiresAt: null, analysisLimit: null, used: 0, source: "owner" };
}
export async function requireProfile(db: D1Database, userId: string, allowedTypes?: AccountType[]): Promise<Profile> {
  const profile = await getProfile(db, userId);
  if (!profile) throw new HttpError(403, "계정 유형을 등록한 후 이용하세요.", "PROFILE_REQUIRED");
  if (allowedTypes && !allowedTypes.includes(profile.accountType)) throw new HttpError(403, "이 계정 유형에서는 이용할 수 없는 기능입니다.", "ACCOUNT_TYPE_REQUIRED");
  return profile;
}
export async function getEntitlement(db: D1Database, userId: string): Promise<Entitlement | null> {
  const access = await ownerAccess(db, userId);
  if (access) return access.mode === "academy_student" ? null : ownerEntitlement(userId, access.mode);
  const item = await db.prepare("SELECT user_id AS userId, plan, status, expires_at AS expiresAt, analysis_limit AS analysisLimit, used FROM product_entitlements WHERE user_id = ?").bind(userId).first<Entitlement>();
  if (item?.status === "active" && item.expiresAt && (!Number.isFinite(Date.parse(item.expiresAt)) || Date.parse(item.expiresAt) <= Date.now())) return { ...item, status: "inactive" };
  return item;
}
export async function requireEntitlement(db: D1Database, userId: string, plans: Plan[]): Promise<Entitlement> {
  // Ownership is a permanent paid grant. Mode selection changes the workspace;
  // it must not suspend classes whose billing teacher is the owner.
  if (await ownerAccess(db, userId)) return ownerEntitlement(userId, plans[0]);
  const item = await getEntitlement(db, userId);
  if (!item || item.status !== "active" || !plans.includes(item.plan)) throw new HttpError(402, "유효한 이용권이 필요합니다. 결제 연결 전에는 예시 체험을 이용할 수 있습니다.", "ENTITLEMENT_REQUIRED");
  return item;
}
export async function classMembership(db: D1Database, classId: string, userId: string): Promise<ClassMember | null> {
  return db.prepare("SELECT class_id AS classId, user_id AS userId, role, display_name AS displayName, joined_at AS joinedAt FROM product_members WHERE class_id = ? AND user_id = ?").bind(classId, userId).first<ClassMember>();
}
export async function requireClassTeacher(db: D1Database, classId: string, userId: string, paid = false): Promise<ClassMember> {
  await requireProfile(db, userId, ["teacher"]);
  const member = await classMembership(db, classId, userId);
  if (member?.role !== "teacher") throw new HttpError(403, "이 반의 담당 선생님만 이용할 수 있습니다.", "CLASS_TEACHER_REQUIRED");
  if (paid) await requireEntitlement(db, userId, ["teacher"]);
  return member;
}
export async function getExam(db: D1Database, id: string): Promise<Exam> {
  const row = await db.prepare("SELECT data, revision FROM product_exams WHERE id = ?").bind(id).first<{data: string; revision: number}>();
  if (!row) throw new HttpError(404, "시험을 찾을 수 없습니다.");
  return { ...JSON.parse(row.data) as Exam, revision: row.revision };
}

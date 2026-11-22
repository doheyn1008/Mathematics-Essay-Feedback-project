import { handleSecurity, securitySettings } from "./product-security";
import { handlePhone, phoneTrial } from "./product-phone";
import { env } from "cloudflare:workers";
import type { AccountSettings, ContributionPoint, ExamSubmission, NotificationPreferences } from "../product-types";
import { checkProductOrigin, getProfile, productJson, readProductJson, requireProductUser } from "./product-auth";
import { authProviders } from "./product-login";
import { HttpError } from "./validation";
import { requireAdmin } from "./admin-auth";
import { isOwnerAccount } from "./product-auth";

export const defaultPreferences: NotificationPreferences = { google: false, kakao: false, submissions: false, feedback: false };
export function usageRewardPolicy() {
  const config = env as unknown as Record<string, unknown>, amount = Number(config.CONTRIBUTION_USE_POINTS);
  const version = typeof config.CONTRIBUTION_USE_POLICY_VERSION === "string" ? config.CONTRIBUTION_USE_POLICY_VERSION.trim() : "";
  return { amount: Number.isSafeInteger(amount) && amount > 0 && amount <= 100000 && version ? amount : null, version: version || null };
}
export async function pointLedger(db: D1Database, userId: string): Promise<ContributionPoint[]> {
  const initial = await db.prepare("SELECT id, contribution_id AS contributionId, amount, policy_version AS policyVersion, created_at AS createdAt FROM product_points WHERE user_id = ? ORDER BY created_at DESC").bind(userId).all<ContributionPoint>();
  const extra = await db.prepare("SELECT id, contribution_id AS contributionId, amount, policy_version AS policyVersion, created_at AS createdAt, kind FROM product_point_events WHERE user_id = ? ORDER BY created_at DESC").bind(userId).all<ContributionPoint>();
  return [...initial.results.map(p => ({ ...p, kind: "contribution" as const })),...extra.results].sort((a,b) => b.createdAt.localeCompare(a.createdAt));
}
export async function notificationWrites(db: D1Database, item: ExamSubmission, kind: "submission"|"feedback", eventKey: string): Promise<D1PreparedStatement[]> {
  const recipients = kind === "feedback" ? [{user_id:item.studentId}] : item.classId ? (await db.prepare("SELECT user_id FROM product_members WHERE class_id = ? AND role = 'teacher'").bind(item.classId).all<{user_id:string}>()).results : [];
  const writes: D1PreparedStatement[] = [];
  for (const recipient of recipients) {
    const settings = await db.prepare("SELECT data FROM product_notification_settings WHERE user_id = ?").bind(recipient.user_id).first<{data:string}>();
    const prefs = settings ? JSON.parse(settings.data) as NotificationPreferences : defaultPreferences;
    if (!(kind === "submission" ? prefs.submissions : prefs.feedback)) continue;
    for (const channel of ["google","kakao"] as const) if (prefs[channel]) {
      // Consent and linkage are checked again by a future sender; this is an outbox, never a sent receipt.
      writes.push(db.prepare("INSERT OR IGNORE INTO product_notifications (id,user_id,channel,event_key,kind,submission_id,created_at) SELECT ?,?,?,?,?,?,? FROM product_links WHERE user_id = ? AND provider = ? AND (? != 'google' OR email != '') AND (? = 'submission' OR EXISTS (SELECT 1 FROM product_versions WHERE id = ? AND published = 1))").bind(crypto.randomUUID(),recipient.user_id,channel,eventKey,kind,item.id,new Date().toISOString(),recipient.user_id,channel,channel,kind,eventKey.slice("feedback:".length)));
    }
  }
  return writes;
}
export async function handleAccount(request: Request, path: string, db: D1Database) {
  const user = await requireProductUser(request);
  if (request.method === "GET" && path === "settings") {
    const row = await db.prepare("SELECT data FROM product_notification_settings WHERE user_id = ?").bind(user.id).first<{data:string}>();
    const links = await db.prepare("SELECT provider,email FROM product_links WHERE user_id = ?").bind(user.id).all<{provider:"google"|"kakao";email:string}>();
    const notifications = await db.prepare("SELECT kind,channel,status,created_at AS createdAt FROM product_notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 30").bind(user.id).all<AccountSettings["notifications"][number]>();
    const result: AccountSettings = { security:await securitySettings(db,user.id), phoneTrial:await phoneTrial(db,user.id), providers:authProviders(), links:links.results, preferences:row ? JSON.parse(row.data) : defaultPreferences, points:await pointLedger(db,user.id), useReward:usageRewardPolicy(), notifications:notifications.results, deliveryConfigured:false, purchasesConfigured:false };
    return productJson(result);
  }
  if (request.method !== "POST") throw new HttpError(404,"요청한 기능을 찾을 수 없습니다.");
  checkProductOrigin(request);
  if (path === "mode") {
    const actor = await requireAdmin(request);
    if (actor.id !== user.id || !isOwnerAccount(user.id)) throw new HttpError(403,"관리자 계정만 모드를 변경할 수 있습니다.","OWNER_MODE_REQUIRED");
    const body = await readProductJson(request);
    if (typeof body.mode !== "string" || !["teacher","academy_student","personal_basic","personal_premium"].includes(body.mode)) throw new HttpError(400,"이용 모드를 선택하세요.");
    if (!await getProfile(db,user.id)) throw new HttpError(403,"계정 등록을 먼저 완료하세요.","PROFILE_REQUIRED");
    const accountType = body.mode === "teacher" || body.mode === "academy_student" ? body.mode : "personal";
    await db.batch([
      db.prepare("INSERT INTO product_owner_modes (user_id,mode,updated_at) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET mode=excluded.mode,updated_at=excluded.updated_at").bind(user.id,body.mode,new Date().toISOString()),
      db.prepare("UPDATE product_profiles SET account_type=? WHERE user_id=?").bind(accountType,user.id),
    ]);
    return productJson({ mode: body.mode });
  }
  if (path === "password" || path === "withdraw") return handleSecurity(request,path,db);
  if (path.startsWith("phone/")) return handlePhone(request,path.slice(6),db,user);
  if (path === "points/purchase") throw new HttpError(503,"포인트 상품과 결제 연결을 준비 중입니다. 결제나 포인트 지급은 실행되지 않았습니다.","PAYMENT_NOT_CONFIGURED");
  if (path !== "settings") throw new HttpError(404,"요청한 기능을 찾을 수 없습니다.");
  const body = await readProductJson(request), prefs: Record<string,boolean> = {};
  for (const key of Object.keys(defaultPreferences)) { if (typeof body[key] !== "boolean") throw new HttpError(400,"알림 동의 항목을 확인하세요."); prefs[key]=body[key] as boolean; }
  const profile = await getProfile(db,user.id);
  if (profile?.accountType !== "teacher") prefs.submissions = false;
  await db.prepare("INSERT INTO product_notification_settings (user_id,data,updated_at) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at").bind(user.id,JSON.stringify(prefs),new Date().toISOString()).run();
  return productJson({preferences:prefs});
}

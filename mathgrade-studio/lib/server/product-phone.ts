import { env } from "cloudflare:workers";
import { createHmac } from "node:crypto";
import type { PhoneTrial } from "../product-types";
import { productJson, readProductJson, requireProfile, type ProductUser } from "./product-auth";
import { HttpError } from "./validation";

type Grant = { phone_masked: string; verified_at: string; used_submission_id: string | null };
type Challenge = { id: string; phone_hash: string; phone_masked: string; provider_sid: string; service_sid: string; expires_at: string };
const config = () => env as unknown as Record<string, string | undefined>;
function providerConfig() {
  const c = config();
  if (!c.TWILIO_ACCOUNT_SID || !c.TWILIO_AUTH_TOKEN || !/^VA[a-f\d]{32}$/i.test(c.TWILIO_VERIFY_SERVICE_SID || "") || (c.PHONE_IDENTITY_SECRET?.length ?? 0) < 32) return null;
  return { account: c.TWILIO_ACCOUNT_SID, token: c.TWILIO_AUTH_TOKEN, service: c.TWILIO_VERIFY_SERVICE_SID!, secret: c.PHONE_IDENTITY_SECRET! };
}
export function normalizePhone(value: unknown): string {
  if (typeof value !== "string" || value.length > 40) throw new HttpError(400, "휴대전화 번호를 확인하세요.");
  let phone = value.replace(/[\s()-]/g, "");
  if (/^010\d{8}$/.test(phone)) phone = `+82${phone.slice(1)}`;
  if (!/^\+[1-9]\d{7,14}$/.test(phone) || /^\+820/.test(phone)) throw new HttpError(400, "010으로 시작하는 휴대전화 번호 또는 국가번호를 포함한 번호를 입력하세요.");
  return phone;
}
function phoneHash(phone: string, secret: string) { return createHmac("sha256", secret).update(phone).digest("hex"); }
async function grant(db: D1Database, userId: string) { return db.prepare("SELECT phone_masked,verified_at,used_submission_id FROM product_phone_trials WHERE user_id = ?").bind(userId).first<Grant>(); }
export async function phoneTrial(db: D1Database, userId: string): Promise<PhoneTrial> {
  const record = await grant(db, userId);
  return { configured: Boolean(providerConfig()), verified: Boolean(record), maskedPhone: record?.phone_masked ?? null, remaining: record && !record.used_submission_id ? 1 : 0, verifiedAt: record?.verified_at ?? null };
}
export async function requirePhoneTrial(db: D1Database, userId: string) {
  const status = await phoneTrial(db, userId);
  if (!status.verified) throw new HttpError(403, "전화번호 인증 후 무료 첨삭 1회를 받을 수 있습니다.", "PHONE_VERIFICATION_REQUIRED");
  if (!status.remaining) throw new HttpError(402, "전화번호 인증으로 받은 무료 첨삭 1회를 이미 사용했습니다.", "FREE_TRIAL_USED");
}
async function rateLimit(db: D1Database, key: string, maximum: number, windowMs: number) {
  const at = Date.now();
  await db.prepare("INSERT INTO product_auth_attempts (key,attempts,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET attempts = CASE WHEN expires_at <= ? THEN 1 ELSE attempts + 1 END, expires_at = CASE WHEN expires_at <= ? THEN excluded.expires_at ELSE expires_at END").bind(key, at + windowMs, at, at).run();
  const row = await db.prepare("SELECT attempts FROM product_auth_attempts WHERE key = ?").bind(key).first<{attempts:number}>();
  if (!row || row.attempts > maximum) throw new HttpError(429, "인증 요청이 많습니다. 잠시 후 다시 시도하세요.", "PHONE_RATE_LIMITED");
}
async function providerRequest(path: string, body: URLSearchParams, c: NonNullable<ReturnType<typeof providerConfig>>) {
  let response: Response;
  try { response = await fetch(`https://verify.twilio.com/v2/Services/${c.service}/${path}`, { method: "POST", headers: { Authorization: `Basic ${Buffer.from(`${c.account}:${c.token}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" }, body, signal: AbortSignal.timeout(10000) }); }
  catch { throw new HttpError(502, "문자 인증 서비스에 연결하지 못했습니다. 다시 시도하세요.", "PHONE_PROVIDER_UNAVAILABLE"); }
  if (!response.ok) throw new HttpError(response.status === 429 ? 429 : 502, response.status === 429 ? "문자 인증 요청이 많습니다. 잠시 후 다시 시도하세요." : "문자 인증을 확인할 수 없습니다. 번호와 인증번호를 확인하거나 새로 요청하세요.", "PHONE_PROVIDER_REJECTED");
  return await response.json() as { status?: string; sid?: string; to?: string; service_sid?: string };
}
export async function handlePhone(request: Request, path: string, db: D1Database, user: ProductUser) {
  await requireProfile(db, user.id); // Same eligibility for teachers, academy students and personal accounts.
  if (request.method !== "POST" || !["start", "verify"].includes(path)) throw new HttpError(404, "요청한 기능을 찾을 수 없습니다.");
  const existing = await grant(db, user.id);
  if (existing) return productJson({ trial: await phoneTrial(db, user.id), alreadyVerified: true });
  const c = providerConfig();
  if (!c) throw new HttpError(503, "문자 인증 연결을 준비 중입니다. 인증 완료 후 무료 첨삭 1회가 제공됩니다.", "PHONE_NOT_CONFIGURED");
  const body = await readProductJson(request);
  if (path === "start") {
    if (body.consent !== true) throw new HttpError(400, "전화번호 인증과 중복 지급 방지 목적의 이용에 동의해 주세요.");
    const phone = normalizePhone(body.phone), hash = phoneHash(phone, c.secret);
    // Phone plaintext and OTP are never stored in our database or returned to the browser.
    const claimed = await db.prepare("SELECT user_id FROM product_phone_trials WHERE phone_hash = ?").bind(hash).first();
    if (claimed) throw new HttpError(409, "이 번호에는 무료 첨삭 기회가 이미 지급되었습니다.", "PHONE_TRIAL_CLAIMED");
    await rateLimit(db, `phone-send-user:${user.id}`, 5, 3600000);
    await rateLimit(db, `phone-send-number:${hash}`, 5, 3600000);
    const ip = createHmac("sha256", c.secret).update(request.headers.get("cf-connecting-ip") || "local").digest("hex");
    await rateLimit(db, `phone-send-ip:${ip}`, 20, 3600000);
    // An atomic cooldown prevents parallel requests from sending multiple SMS messages.
    const cooldown = await db.prepare("INSERT INTO product_phone_cooldowns (user_id,expires_at) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET expires_at=excluded.expires_at WHERE product_phone_cooldowns.expires_at <= ?").bind(user.id, Date.now() + 60000, Date.now()).run();
    if (!cooldown.meta.changes) throw new HttpError(429, "인증 문자는 60초 후 다시 요청할 수 있습니다.", "PHONE_RESEND_COOLDOWN");
    const sent = await providerRequest("Verifications", new URLSearchParams({ To: phone, Channel: "sms" }), c);
    if (sent.status !== "pending" || !/^VE[a-f\d]{32}$/i.test(sent.sid || "") || (sent.service_sid && sent.service_sid !== c.service)) throw new HttpError(502, "문자 발송을 확인할 수 없습니다.", "PHONE_PROVIDER_REJECTED");
    const id = crypto.randomUUID(), expiresAt = new Date(Date.now() + 10 * 60000).toISOString(), masked = `${phone.startsWith("+82") ? "010" : phone.slice(0, 3)}-****-${phone.slice(-4)}`;
    await db.prepare("INSERT INTO product_phone_challenges (id,user_id,phone_hash,phone_masked,provider_sid,service_sid,expires_at,attempts,status) VALUES (?,?,?,?,?,?,?,0,'pending')").bind(id, user.id, hash, masked, sent.sid, c.service, expiresAt).run();
    return productJson({ challengeId: id, maskedPhone: masked, expiresAt, retryAfter: 60 });
  }
  if (typeof body.challengeId !== "string" || typeof body.code !== "string" || !/^\d{6}$/.test(body.code)) throw new HttpError(400, "문자로 받은 인증번호 6자리를 입력하세요.");
  const row = await db.prepare("SELECT id,phone_hash,phone_masked,provider_sid,service_sid,expires_at FROM product_phone_challenges WHERE id = ? AND user_id = ? AND status = 'pending' AND expires_at > ? AND attempts < 5").bind(body.challengeId, user.id, new Date().toISOString()).first<Challenge>();
  if (!row || row.service_sid !== c.service) throw new HttpError(400, "인증 요청이 만료되었거나 시도 횟수를 초과했습니다. 새 인증 문자를 요청하세요.", "PHONE_CHALLENGE_EXPIRED");
  const attempt = await db.prepare("UPDATE product_phone_challenges SET attempts=attempts+1 WHERE id = ? AND user_id = ? AND status='pending' AND expires_at > ? AND attempts < 5").bind(row.id, user.id, new Date().toISOString()).run();
  if (!attempt.meta.changes) throw new HttpError(429, "인증 시도 횟수를 초과했습니다. 새 인증 문자를 요청하세요.");
  const checked = await providerRequest("VerificationCheck", new URLSearchParams({ VerificationSid: row.provider_sid, Code: body.code }), c);
  if (checked.status !== "approved" || checked.sid !== row.provider_sid || !checked.to || phoneHash(normalizePhone(checked.to), c.secret) !== row.phone_hash) throw new HttpError(400, "인증번호가 일치하지 않습니다.", "PHONE_CODE_INVALID");
  const verifiedAt = new Date().toISOString();
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO product_phone_trials (user_id,phone_hash,phone_masked,verified_at) SELECT user_id,phone_hash,phone_masked,? FROM product_phone_challenges WHERE id = ? AND user_id = ? AND status='pending' AND expires_at > ?").bind(verifiedAt, row.id, user.id, verifiedAt),
    db.prepare("UPDATE product_phone_challenges SET status='approved' WHERE id = ? AND EXISTS (SELECT 1 FROM product_phone_trials WHERE user_id = ? AND phone_hash = ?)").bind(row.id, user.id, row.phone_hash),
  ]);
  const granted = await grant(db, user.id);
  if (!granted) throw new HttpError(409, "이 번호에는 무료 첨삭 기회가 이미 지급되었거나 인증이 만료되었습니다.", "PHONE_TRIAL_CLAIMED");
  return productJson({ trial: await phoneTrial(db, user.id) });
}

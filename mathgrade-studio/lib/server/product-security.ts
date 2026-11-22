import { randomBytes } from "node:crypto";
import { productJson, readProductJson, requireProductUser, type ProductUser } from "./product-auth";
import { passwordHash, passwordMatches, tokenHash, clearAuthCookie, sensitiveLimit } from "./product-login";
import { normalizePhone, phoneHash, providerConfig, providerRequest, rateLimit } from "./product-phone";
import { departureBlockers } from "./product-management";
import { HttpError, requireText } from "./validation";

const stamp=()=>new Date().toISOString();
export async function securitySettings(db:D1Database,userId:string) {
  const native=await db.prepare("SELECT username FROM product_credentials WHERE user_id=?").bind(userId).first<{username:string}>();
  return {username:native?.username ?? null,hasPassword:Boolean(native),recoveryConfigured:Boolean(providerConfig()),withdrawalBlockers:await departureBlockers(db,userId)};
}
function newPassword(value:unknown):string {
  if (typeof value !== "string" || value.length < 10 || value.length > 128) throw new HttpError(400,"새 비밀번호는 10~128자로 입력하세요.");
  return value;
}
export async function securityProof(db:D1Database,userId:string,purpose:string) {
  const token=randomBytes(32).toString("hex"),expiresAt=new Date(Date.now()+5*60000).toISOString();
  await db.prepare("INSERT INTO product_security_tokens (token_hash,user_id,purpose,expires_at) VALUES (?,?,?,?)").bind(await tokenHash(token),userId,purpose,expiresAt).run();
  return token;
}
export async function handleRecovery(request:Request,path:string,db:D1Database):Promise<Response> {
  const body=await readProductJson(request),c=providerConfig();
  if (!c) throw new HttpError(503,"문자 인증 연결을 준비 중입니다. 복구가 완료되지 않았습니다. 소셜 가입자는 해당 제공자의 로그인·복구를 이용하세요.","RECOVERY_NOT_CONFIGURED");
  if (path === "start") {
    if (body.purpose !== "username" && body.purpose !== "password") throw new HttpError(400,"복구할 항목을 선택하세요.");
    const phone=normalizePhone(body.phone),hash=phoneHash(phone,c.secret);
    await rateLimit(db,`recovery-phone:${hash}`,5,3600000);
    await rateLimit(db,`recovery-ip:${await tokenHash(request.headers.get("cf-connecting-ip") || "local")}`,20,3600000);
    const cooldown=await db.prepare("INSERT INTO product_phone_cooldowns (user_id,expires_at) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET expires_at=excluded.expires_at WHERE product_phone_cooldowns.expires_at<=?").bind(`recovery:${hash}`,Date.now()+60000,Date.now()).run();
    if (!cooldown.meta.changes) throw new HttpError(429,"인증 문자는 60초 후 다시 요청하세요.");
    const nativeName=body.purpose === "password" ? requireText(body.username,"아이디",40).toLowerCase() : "";
    const target=await db.prepare("SELECT p.user_id FROM product_phone_trials p WHERE p.phone_hash=? AND NOT EXISTS (SELECT 1 FROM product_closed_accounts c WHERE c.user_id=p.user_id) AND (?='' OR EXISTS (SELECT 1 FROM product_credentials c WHERE c.user_id=p.user_id AND c.username=?))").bind(hash,nativeName,nativeName).first<{user_id:string}>();
    let sid="";
    if (target) {
      const sent=await providerRequest("Verifications",new URLSearchParams({To:phone,Channel:"sms"}),c);
      if (sent.status !== "pending" || !/^VE[a-f\d]{32}$/i.test(sent.sid || "") || (sent.service_sid && sent.service_sid !== c.service)) throw new HttpError(502,"문자 인증 요청을 확인할 수 없습니다.");
      sid=sent.sid!;
    }
    const id=crypto.randomUUID(),expiresAt=new Date(Date.now()+10*60000).toISOString();
    await db.prepare("INSERT INTO product_recovery_challenges (id,user_id,purpose,phone_hash,provider_sid,service_sid,expires_at) VALUES (?,?,?,?,?,?,?)").bind(id,target?.user_id ?? null,body.purpose,hash,sid,c.service,expiresAt).run();
    return productJson({challengeId:id,expiresAt,message:"가입 계정에 인증된 번호가 일치하면 인증 문자를 보냅니다. 소셜 전용 계정의 비밀번호는 해당 제공자에서 복구하세요."});
  }
  if (path !== "verify") throw new HttpError(404,"요청한 기능을 찾을 수 없습니다.");
  const id=requireText(body.challengeId,"인증 요청",100);
  if (typeof body.code !== "string" || !/^\d{6}$/.test(body.code)) throw new HttpError(400,"인증번호 6자리를 입력하세요.");
  const row=await db.prepare("SELECT * FROM product_recovery_challenges WHERE id=? AND status='pending' AND expires_at>? AND attempts<5").bind(id,stamp()).first<{user_id:string|null;purpose:string;phone_hash:string;provider_sid:string;service_sid:string}>();
  if (!row || row.service_sid !== c.service) throw new HttpError(400,"만료되었거나 이미 사용한 인증 요청입니다.","RECOVERY_EXPIRED");
  const attempt=await db.prepare("UPDATE product_recovery_challenges SET attempts=attempts+1 WHERE id=? AND status='pending' AND expires_at>? AND attempts<5").bind(id,stamp()).run();
  if (!attempt.meta.changes || !row.user_id || !row.provider_sid) throw new HttpError(400,"인증 정보를 확인하거나 새로 요청하세요.");
  const checked=await providerRequest("VerificationCheck",new URLSearchParams({VerificationSid:row.provider_sid,Code:body.code}),c);
  if (checked.status !== "approved" || checked.sid !== row.provider_sid || !checked.to || phoneHash(normalizePhone(checked.to),c.secret)!==row.phone_hash) throw new HttpError(400,"인증번호를 확인하세요.");
  const consumed=await db.prepare("UPDATE product_recovery_challenges SET status='used' WHERE id=? AND status='pending' AND expires_at>?").bind(id,stamp()).run();
  if (!consumed.meta.changes) throw new HttpError(400,"이미 사용했거나 만료된 인증 요청입니다.");
  if (row.purpose === "username") {
    const credential=await db.prepare("SELECT username FROM product_credentials WHERE user_id=?").bind(row.user_id).first<{username:string}>();
    const links=await db.prepare("SELECT provider FROM product_links WHERE user_id=?").bind(row.user_id).all<{provider:string}>();
    return productJson({username:credential?.username ?? null,providers:links.results.map(l=>l.provider)});
  }
  return productJson({resetToken:await securityProof(db,row.user_id,"password")});
}
export async function resetPassword(request:Request,db:D1Database):Promise<Response> {
  const body=await readProductJson(request),password=newPassword(body.password),hash=await tokenHash(requireText(body.resetToken,"재설정 인증",128));
  await rateLimit(db,`reset-ip:${await tokenHash(request.headers.get("cf-connecting-ip") || "local")}`,20,3600000);
  const proof=await db.prepare("SELECT user_id FROM product_security_tokens WHERE token_hash=? AND purpose='password' AND consumed_at IS NULL AND expires_at>?").bind(hash,stamp()).first<{user_id:string}>();
  if (!proof) throw new HttpError(400,"재설정 인증이 만료되었거나 이미 사용되었습니다.","RESET_TOKEN_INVALID");
  const next=await passwordHash(password),at=crypto.randomUUID();
  const writes=await db.batch([
    db.prepare("UPDATE product_security_tokens SET consumed_at=? WHERE token_hash=? AND consumed_at IS NULL AND expires_at>?").bind(at,hash,stamp()),
    db.prepare("UPDATE product_credentials SET password_hash=? WHERE user_id=? AND EXISTS (SELECT 1 FROM product_security_tokens WHERE token_hash=? AND consumed_at=?)").bind(next,proof.user_id,hash,at),
    db.prepare("DELETE FROM product_sessions WHERE user_id=? AND EXISTS (SELECT 1 FROM product_security_tokens WHERE token_hash=? AND consumed_at=?)").bind(proof.user_id,hash,at),
    db.prepare("DELETE FROM product_oauth WHERE user_id=? AND EXISTS (SELECT 1 FROM product_security_tokens WHERE token_hash=? AND consumed_at=?)").bind(proof.user_id,hash,at),
    db.prepare("DELETE FROM product_recovery_challenges WHERE user_id=? AND EXISTS (SELECT 1 FROM product_security_tokens WHERE token_hash=? AND consumed_at=?)").bind(proof.user_id,hash,at),
    db.prepare("DELETE FROM product_security_tokens WHERE user_id=? AND token_hash!=? AND EXISTS (SELECT 1 FROM product_security_tokens own WHERE own.token_hash=? AND own.consumed_at=?)").bind(proof.user_id,hash,hash,at),
  ]);
  if (!writes[0].meta.changes || !writes[1].meta.changes) throw new HttpError(400,"재설정 인증을 다시 진행하세요.","RESET_TOKEN_INVALID");
  return clearAuthCookie(request,productJson({ok:true,reauthenticate:true}));
}
async function checkPassword(request:Request,db:D1Database,user:ProductUser,value:unknown) {
  await sensitiveLimit(request,user.id);
  const credential=await db.prepare("SELECT password_hash FROM product_credentials WHERE user_id=?").bind(user.id).first<{password_hash:string}>();
  if (!credential) throw new HttpError(409,"소셜 전용 계정은 연결한 Google·카카오에서 비밀번호를 관리하세요.","SOCIAL_ACCOUNT");
  if (typeof value !== "string" || value.length>128 || !await passwordMatches(value,credential.password_hash)) throw new HttpError(401,"현재 비밀번호를 확인하세요.");
  return credential.password_hash;
}
export async function handleSecurity(request:Request,path:string,db:D1Database):Promise<Response> {
  const user=await requireProductUser(request),body=await readProductJson(request);
  if (path === "password") {
    const prior=await checkPassword(request,db,user,body.currentPassword),next=await passwordHash(newPassword(body.password));
    const writes=await db.batch([
      db.prepare("UPDATE product_credentials SET password_hash=? WHERE user_id=? AND password_hash=?").bind(next,user.id,prior),
      db.prepare("DELETE FROM product_sessions WHERE user_id=? AND EXISTS (SELECT 1 FROM product_credentials WHERE user_id=? AND password_hash=?)").bind(user.id,user.id,next),
      db.prepare("DELETE FROM product_security_tokens WHERE user_id=? AND EXISTS (SELECT 1 FROM product_credentials WHERE user_id=? AND password_hash=?)").bind(user.id,user.id,next),
      db.prepare("DELETE FROM product_recovery_challenges WHERE user_id=? AND EXISTS (SELECT 1 FROM product_credentials WHERE user_id=? AND password_hash=?)").bind(user.id,user.id,next),
      db.prepare("DELETE FROM product_oauth WHERE user_id=? AND EXISTS (SELECT 1 FROM product_credentials WHERE user_id=? AND password_hash=?)").bind(user.id,user.id,next),
    ]);
    if (!writes[0].meta.changes) throw new HttpError(409,"비밀번호가 변경되었습니다. 다시 로그인하세요.");
    return clearAuthCookie(request,productJson({ok:true,reauthenticate:true}));
  }
  if (path !== "withdraw") throw new HttpError(404,"요청한 기능을 찾을 수 없습니다.");
  if (body.confirmation !== "회원 탈퇴") throw new HttpError(400,"확인란에 ‘회원 탈퇴’를 입력하세요.");
  const credential=await db.prepare("SELECT username FROM product_credentials WHERE user_id=?").bind(user.id).first();
  let proofHash:string|null=null;
  const credentialHash=credential ? await checkPassword(request,db,user,body.currentPassword) : null;
  if (!credential) {
    await sensitiveLimit(request,user.id);
    const token=request.headers.get("cookie")?.match(/(?:^|;\s*)mg_reauth=([a-f0-9]{64})(?:;|$)/)?.[1];
    proofHash=await tokenHash(token || "");
    if (!await db.prepare("SELECT token_hash FROM product_security_tokens WHERE token_hash=? AND user_id=? AND purpose='withdraw' AND consumed_at IS NULL AND expires_at>?").bind(proofHash,user.id,stamp()).first()) throw new HttpError(401,"연결한 소셜 계정으로 다시 인증한 뒤 탈퇴하세요.","REAUTH_REQUIRED");
  }
  const blocked=await departureBlockers(db,user.id);
  if (blocked.length) throw new HttpError(409,`담당·비용 부담을 인계하거나 반을 보관하세요: ${blocked.join(", ")}`,"CLASS_HANDOVER_REQUIRED");
  const at=stamp(), marker=crypto.randomUUID();
  // The database guard closes the race with another teacher leaving or changing the payer.
  const guard="NOT EXISTS (SELECT 1 FROM product_classes c JOIN product_members m ON c.id=m.class_id WHERE m.user_id=? AND m.role='teacher' AND json_extract(c.data,'$.archivedAt') IS NULL AND (json_extract(c.data,'$.billingTeacherId')=? OR (SELECT COUNT(*) FROM product_members other WHERE other.class_id=c.id AND other.role='teacher')<2))";
  const condition="EXISTS (SELECT 1 FROM product_closed_accounts WHERE user_id=? AND closed_at=?)";
  const authGuard=credentialHash ? "EXISTS (SELECT 1 FROM product_credentials WHERE user_id=? AND password_hash=?)" : "EXISTS (SELECT 1 FROM product_security_tokens WHERE user_id=? AND token_hash=? AND purpose='withdraw' AND consumed_at IS NULL AND expires_at>?)";
  const authArgs=credentialHash ? [user.id,credentialHash] : [user.id,proofHash,at];
  const writes:D1PreparedStatement[]=[db.prepare(`INSERT INTO product_closed_accounts (user_id,closed_at) SELECT ?,? WHERE ${guard} AND ${authGuard}`).bind(user.id,at,user.id,user.id,...authArgs)];
  const run=(sql:string,...args:(string|null)[])=>writes.push(db.prepare(`${sql} AND ${condition}`).bind(...args,user.id,at));
  run("DELETE FROM product_members WHERE user_id=?",user.id);
  for (const table of ["product_owner_modes","product_sessions","product_credentials","product_links","product_notification_settings","product_notifications","product_phone_challenges","product_phone_cooldowns","product_recovery_challenges","product_oauth"]) run(`DELETE FROM ${table} WHERE user_id=?`,user.id);
  run("DELETE FROM product_security_tokens WHERE user_id=?",user.id);
  run("UPDATE product_entitlements SET status='inactive' WHERE user_id=?",user.id);
  run("UPDATE product_profiles SET display_name='탈퇴한 회원' WHERE user_id=?",user.id);
  run("UPDATE product_users SET name='탈퇴한 회원',email='' WHERE id=?",user.id);
  run("UPDATE product_submissions SET data=json_set(data,'$.studentName','탈퇴한 회원') WHERE student_id=?",user.id);
  run("UPDATE product_versions SET data=json_set(data,'$.authorName','탈퇴한 회원') WHERE json_extract(data,'$.authorId')=?",user.id);
  run("UPDATE product_messages SET data=json_set(data,'$.authorName','탈퇴한 회원') WHERE author_id=?",user.id);
  run("UPDATE product_submissions SET data=json_set(data,'$.latestVersion.authorName','탈퇴한 회원') WHERE json_extract(data,'$.latestVersion.authorId')=?",user.id);
  run("UPDATE product_contributions SET status='withdrawn',data=json_set(data,'$.status','withdrawn','$.contributorName','탈퇴한 회원') WHERE contributor_id=?",user.id);
  // HMAC-only deduplication tombstones survive withdrawal; no reusable phone mask or login identity.
  run("UPDATE product_phone_trials SET phone_masked='',user_id=? WHERE user_id=?",`closed:${marker}`,user.id);
  const result=await db.batch(writes);
  if (!result[0].meta.changes) throw new HttpError(409,"반 담당 상태가 변경되었습니다. 인계 상태를 다시 확인하세요.","CLASS_HANDOVER_REQUIRED");
  return clearAuthCookie(request,productJson({ok:true}));
}

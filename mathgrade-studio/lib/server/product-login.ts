import { handleRecovery, resetPassword, securityProof } from "./product-security";
import { env } from "cloudflare:workers";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { checkProductOrigin, productDatabase, productIdentity, productJson, readProductJson, requireProductUser } from "./product-auth";
import { HttpError, requireText } from "./validation";

const config = () => env as unknown as Record<string, string | undefined>;
const stamp = () => new Date().toISOString();
export async function tokenHash(value: string) { return Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))).toString("hex"); }
function derive(password: string, salt: string): Promise<Buffer> {
  // Native scrypt works in Workers; 16 MiB per derivation, OWASP's N=2^14/r=8/p=5 profile.
  return new Promise((resolve, reject) => scrypt(password, salt, 64, { N: 16384, r: 8, p: 5, maxmem: 32 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key)));
}
export async function passwordHash(password: string) { const salt = randomBytes(16).toString("hex"); return `scrypt-v1:${salt}:${(await derive(password, salt)).toString("hex")}`; }
export async function passwordMatches(password: string, encoded: string) {
  const [version, salt, value] = encoded.split(":");
  if (version !== "scrypt-v1" || !salt || !value) return false;
  const actual = await derive(password, salt), expected = Buffer.from(value, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export function cookie(request: Request, name: string, value: string, age: number) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`;
}
async function session(request: Request, userId: string, redirect = false) {
  const token = randomBytes(32).toString("hex"), db = productDatabase();
  await db.prepare("INSERT INTO product_sessions (token_hash,user_id,expires_at) VALUES (?,?,?)").bind(await tokenHash(token), userId, new Date(Date.now() + 7 * 86400000).toISOString()).run();
  // Rotate an existing browser session when authentication succeeds.
  const prior = request.headers.get("cookie")?.match(/(?:^|;\s*)mg_session=([a-f0-9]{64})(?:;|$)/)?.[1];
  if (prior) await db.prepare("DELETE FROM product_sessions WHERE token_hash = ?").bind(await tokenHash(prior)).run();
  const response = redirect ? new Response(null, { status: 303, headers: { Location: "/" } }) : productJson({ ok: true });
  response.headers.append("Set-Cookie", cookie(request, "mg_session", token, 7 * 86400));
  return response;
}
export function authProviders() {
  const c = config();
  return { google: Boolean(c.GOOGLE_CLIENT_ID && c.GOOGLE_CLIENT_SECRET), kakao: Boolean(c.KAKAO_CLIENT_ID && c.KAKAO_CLIENT_SECRET) };
}
async function limit(request: Request, username: string) {
  const db=productDatabase(), at=Date.now(), ip=request.headers.get("cf-connecting-ip") || "local";
  for (const [value,max] of [[`ip:${ip}`,40],[`name-ip:${username}:${ip}`,12],[`name:${username}`,200]] as const) {
    const key=await tokenHash(value);
    await db.prepare("INSERT INTO product_auth_attempts (key,attempts,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN expires_at<=? THEN 1 ELSE attempts+1 END,expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END").bind(key,at+15*60000,at,at).run();
    const row=await db.prepare("SELECT attempts FROM product_auth_attempts WHERE key=?").bind(key).first<{attempts:number}>();
    if (row && row.attempts>max) throw new HttpError(429,"로그인 시도가 많습니다. 잠시 후 다시 시도하세요.");
  }
}
export async function sensitiveLimit(request:Request,userId:string) {
  // Reauthentication has its own bucket; a successful login cannot clear it.
  const db=productDatabase(),key=await tokenHash(`sensitive:${userId}:${request.headers.get("cf-connecting-ip") || "local"}`),at=Date.now();
  await db.prepare("INSERT INTO product_auth_attempts (key,attempts,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN expires_at<=? THEN 1 ELSE attempts+1 END,expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END").bind(key,at+15*60000,at,at).run();
  if ((await db.prepare("SELECT attempts FROM product_auth_attempts WHERE key=?").bind(key).first<{attempts:number}>())!.attempts>10) throw new HttpError(429,"본인 확인 시도가 많습니다. 잠시 후 다시 시도하세요.");
}
export function clearAuthCookie(request:Request,response:Response) {
  for (const name of ["mg_session","mg_oauth","mg_reauth"]) response.headers.append("Set-Cookie",cookie(request,name,"",0));
  return response;
}
async function oauth(request: Request, provider: "google" | "kakao", callback: boolean) {
  if (!authProviders()[provider]) throw new HttpError(503, `${provider === "google" ? "구글" : "카카오"} 로그인 연결을 준비 중입니다.`, "OAUTH_NOT_CONFIGURED");
  const c = config(), url = new URL(request.url), db = productDatabase();
  const prefix = provider.toUpperCase(), clientId = c[`${prefix}_CLIENT_ID`]!, secret = c[`${prefix}_CLIENT_SECRET`]!;
  const redirectUri = `${url.origin}/api/product/auth/${provider}/callback`;
  if (!callback) {
    const reauth=url.searchParams.get("reauth") === "1";
    const link = url.searchParams.get("link") === "1" || reauth;
    const user = link ? await requireProductUser(request) : null;
    if (reauth && !await db.prepare("SELECT subject FROM product_links WHERE user_id=? AND provider=?").bind(user!.id,provider).first()) throw new HttpError(403,"이미 연결한 소셜 계정으로 인증하세요.");
    const state = randomBytes(32).toString("hex"), verifier = randomBytes(32).toString("base64url");
    await db.prepare("INSERT INTO product_oauth (state_hash,provider,user_id,verifier,expires_at,purpose) VALUES (?,?,?,?,?,?)").bind(await tokenHash(state),provider,user?.id ?? null,verifier,new Date(Date.now()+10*60000).toISOString(),reauth ? "withdraw" : "login").run();
    const destination = new URL(provider === "google" ? "https://accounts.google.com/o/oauth2/v2/auth" : "https://kauth.kakao.com/oauth/authorize");
    destination.search = new URLSearchParams({client_id:clientId,redirect_uri:redirectUri,response_type:"code",state,...(provider === "google" ? { scope:"openid email profile",code_challenge:Buffer.from(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(verifier))).toString("base64url"),code_challenge_method:"S256" } : {})}).toString();
    return new Response(null,{status:303,headers:{Location:destination.toString(),"Set-Cookie":cookie(request,"mg_oauth",state,600),"Cache-Control":"no-store","Referrer-Policy":"no-referrer"}});
  }
  const state = url.searchParams.get("state") || "", browserState = request.headers.get("cookie")?.match(/(?:^|;\s*)mg_oauth=([a-f0-9]{64})(?:;|$)/)?.[1];
  if (!state || state !== browserState) throw new HttpError(400,"로그인 요청이 만료되었습니다. 다시 시작하세요.");
  const hash = await tokenHash(state);
  const row = await db.prepare("SELECT user_id,verifier,purpose FROM product_oauth WHERE state_hash = ? AND provider = ? AND expires_at > ?").bind(hash,provider,stamp()).first<{user_id:string|null;verifier:string;purpose:string}>();
  const consumed = await db.prepare("DELETE FROM product_oauth WHERE state_hash = ?").bind(hash).run();
  if (!row || !consumed.meta.changes || url.searchParams.has("error")) throw new HttpError(400,"로그인이 취소되었거나 만료되었습니다.");
  if (row.user_id && (await productIdentity(request))?.id !== row.user_id) throw new HttpError(401,"연동할 계정으로 다시 로그인하세요.");
  const tokenResponse = await fetch(provider === "google" ? "https://oauth2.googleapis.com/token" : "https://kauth.kakao.com/oauth/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"authorization_code",code:requireText(url.searchParams.get("code"),"인가 코드",4096),client_id:clientId,client_secret:secret,redirect_uri:redirectUri,...(provider === "google" ? {code_verifier:row.verifier}: {})}),signal:AbortSignal.timeout(10000)});
  const token = await tokenResponse.json() as {access_token?:string};
  if (!tokenResponse.ok || !token.access_token) throw new HttpError(502,"로그인 제공자 연결을 확인할 수 없습니다.");
  const infoResponse = await fetch(provider === "google" ? "https://openidconnect.googleapis.com/v1/userinfo" : "https://kapi.kakao.com/v2/user/me",{headers:{Authorization:`Bearer ${token.access_token}`},signal:AbortSignal.timeout(10000)});
  const info = await infoResponse.json() as {sub?:string;id?:number;email?:string;email_verified?:boolean;name?:string;properties?:{nickname?:string};kakao_account?:{email?:string;is_email_verified?:boolean}};
  const subject = String(provider === "google" ? info.sub || "" : info.id || "");
  if (!infoResponse.ok || !subject) throw new HttpError(502,"계정 정보를 확인할 수 없습니다.");
  const email = provider === "google" ? (info.email_verified ? info.email || "" : "") : (info.kakao_account?.is_email_verified ? info.kakao_account.email || "" : "");
  const existing = await db.prepare("SELECT user_id FROM product_links WHERE provider = ? AND subject = ?").bind(provider,subject).first<{user_id:string}>();
  if (row.user_id && existing && existing.user_id !== row.user_id) throw new HttpError(409,"이미 다른 계정에 연결된 소셜 계정입니다.");
  if (row.purpose === "withdraw") {
    if (!row.user_id || existing?.user_id !== row.user_id) throw new HttpError(403,"현재 계정에 연결한 소셜 계정으로 인증하세요.");
    const proof=await securityProof(db,row.user_id,"withdraw");
    const response=new Response(null,{status:303,headers:{Location:"/account","Cache-Control":"no-store"}});
    response.headers.append("Set-Cookie",cookie(request,"mg_reauth",proof,300));
    response.headers.append("Set-Cookie",cookie(request,"mg_oauth","",0));
    return response;
  }
  const userId = row.user_id || existing?.user_id || crypto.randomUUID();
  if (await db.prepare("SELECT user_id FROM product_closed_accounts WHERE user_id=?").bind(userId).first()) throw new HttpError(401,"탈퇴한 계정입니다.");
  if (!row.user_id && !existing) await db.prepare("INSERT INTO product_users (id,name,email,created_at) VALUES (?,?,?,?)").bind(userId,info.name || info.properties?.nickname || "회원",email,stamp()).run();
  // Email equality never auto-links accounts. Linking requires an authenticated session.
  await db.prepare("INSERT INTO product_links (provider,subject,user_id,email) VALUES (?,?,?,?) ON CONFLICT(user_id,provider) DO UPDATE SET subject=excluded.subject,email=excluded.email").bind(provider,subject,userId,email).run();
  const response = row.user_id ? new Response(null,{status:303,headers:{Location:"/account"}}) : await session(request,userId,true);
  response.headers.append("Set-Cookie",cookie(request,"mg_oauth","",0));
  return response;
}
export async function handleLogin(request: Request, path: string): Promise<Response> {
  if (request.method === "GET" && path === "providers") return productJson(authProviders());
  const provider = path.match(/^(google|kakao)(\/callback)?$/);
  if (request.method === "GET" && provider) return oauth(request,provider[1] as "google"|"kakao",Boolean(provider[2]));
  if (request.method !== "POST") throw new HttpError(404,"요청한 기능을 찾을 수 없습니다.");
  checkProductOrigin(request);
  const db = productDatabase();
  if (path === "logout") {
    const token = request.headers.get("cookie")?.match(/(?:^|;\s*)mg_session=([a-f0-9]{64})(?:;|$)/)?.[1];
    if (token) await db.prepare("DELETE FROM product_sessions WHERE token_hash = ?").bind(await tokenHash(token)).run();
    const response = productJson({ok:true}); response.headers.set("Set-Cookie",cookie(request,"mg_session","",0)); return response;
  }
  if (path.startsWith("recovery/")) return handleRecovery(request,path.slice(9),db);
  if (path === "reset-password") return resetPassword(request,db);
  if (path !== "login" && path !== "signup") throw new HttpError(404,"요청한 기능을 찾을 수 없습니다.");
  const body = await readProductJson(request), username = requireText(body.username,"아이디",40).toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{3,39}$/.test(username)) throw new HttpError(400,"아이디는 영문·숫자·밑줄·하이픈으로 4~40자 입력하세요.");
  if (typeof body.password !== "string" || body.password.length > 128) throw new HttpError(400,"비밀번호를 확인하세요.");
  const password = body.password;
  if (password.length < 10) throw new HttpError(400,"비밀번호는 10자 이상 입력하세요.");
  await limit(request,username);
  if (path === "signup") {
    const name = requireText(body.displayName,"이름",80);
    if (typeof body.accountType !== "string" || !["teacher","academy_student","personal"].includes(body.accountType)) throw new HttpError(400,"계정 유형을 선택하세요.");
    const id = crypto.randomUUID(), createdAt = stamp(), hash = await passwordHash(password);
    try { await db.batch([
      db.prepare("INSERT INTO product_users (id,name,email,created_at) VALUES (?,?,'',?)").bind(id,name,createdAt),
      db.prepare("INSERT INTO product_credentials (username,user_id,password_hash) VALUES (?,?,?)").bind(username,id,hash),
      db.prepare("INSERT INTO product_profiles (user_id,account_type,display_name,created_at) VALUES (?,?,?,?)").bind(id,body.accountType,name,createdAt),
    ]); } catch (error) { if (await db.prepare("SELECT user_id FROM product_credentials WHERE username = ?").bind(username).first()) throw new HttpError(409,"이미 사용 중인 아이디입니다."); throw error; }
    return session(request,id);
  }
  const credential = await db.prepare("SELECT user_id,password_hash FROM product_credentials WHERE username = ?").bind(username).first<{user_id:string;password_hash:string}>();
  // Do equivalent work for nonexistent accounts, too.
  const valid = await passwordMatches(password,credential?.password_hash || `scrypt-v1:${"0".repeat(32)}:${"0".repeat(128)}`);
  if (!credential || !valid) throw new HttpError(401,"아이디 또는 비밀번호를 확인하세요.");
  await db.prepare("DELETE FROM product_auth_attempts WHERE key=?").bind(await tokenHash(`name-ip:${username}:${request.headers.get("cf-connecting-ip") || "local"}`)).run();
  return session(request,credential.user_id);
}

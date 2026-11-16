"use client";
import { useEffect, useState, type FormEvent } from "react";
import { api } from "@/lib/client/api";
import type { PhoneTrial } from "@/lib/product-types";

export function PhoneTrialPanel({ trial, demo, onVerified, onUse }: { trial: PhoneTrial; demo: boolean; onVerified: (trial: PhoneTrial) => Promise<void>; onUse?: () => void }) {
  const [phone,setPhone] = useState(""), [code,setCode] = useState(""), [consent,setConsent] = useState(false);
  const [challenge,setChallenge] = useState<{id:string;masked:string;expiresAt:string}|null>(null);
  const [busy,setBusy] = useState(false), [error,setError] = useState(""), [message,setMessage] = useState(""), [retryAt,setRetryAt] = useState(0), [now,setNow] = useState(Date.now());
  useEffect(() => { const timer=setInterval(()=>setNow(Date.now()),1000); return ()=>clearInterval(timer); },[]);
  const remaining = Math.max(0,Math.ceil((retryAt-now)/1000));
  const expired = Boolean(challenge && Date.parse(challenge.expiresAt)<=now);
  async function send(event:FormEvent) {
    event.preventDefault();setBusy(true);setError("");setMessage("");
    try {
      const result=await api<{trial?:PhoneTrial;challengeId?:string;maskedPhone:string;expiresAt:string;retryAfter:number}>("/api/product/account/phone/start",{phone,consent});
      if(result.trial){await onVerified(result.trial);return;}
      if(!result.challengeId)throw new Error("인증 요청을 확인할 수 없습니다.");
      setChallenge({id:result.challengeId,masked:result.maskedPhone,expiresAt:result.expiresAt});setCode("");setRetryAt(Date.now()+result.retryAfter*1000);setMessage("인증 문자를 보냈습니다. 10분 안에 인증번호를 입력해 주세요.");
    } catch(error){setError(error instanceof Error?error.message:"인증 문자를 요청하지 못했습니다.");} finally{setBusy(false);}
  }
  async function verify(event:FormEvent) {
    event.preventDefault();if(!challenge)return;setBusy(true);setError("");
    try {const result=await api<{trial:PhoneTrial}>("/api/product/account/phone/verify",{challengeId:challenge.id,code});await onVerified(result.trial);setCode("");setChallenge(null);setMessage(result.trial.remaining?"전화번호 인증 완료! 무료 첨삭 1회가 제공되었습니다.":"전화번호 인증과 무료 첨삭 사용 내역을 확인했습니다.");}
    catch(error){setError(error instanceof Error?error.message:"인증번호를 확인하지 못했습니다.");}finally{setBusy(false);}
  }
  return <section className="p-card p-card-body"><h2>전화번호 인증 · 무료 첨삭 1회</h2><p className="p-margin-top">선생님·학원 학생·개인 학생 모두 전화번호 인증을 마치면 무료 첨삭 1회를 받을 수 있어요.</p><p className="p-help">계정과 전화번호당 최초 1회 제공됩니다. 유료 이용권 없이 직접 가져온 문제와 답안을 첨삭받을 수 있으며, AI 첨삭이 성공했을 때만 차감됩니다.</p>{trial.verified?<><div className="p-note p-margin-top"><span>{trial.maskedPhone} · 인증 완료</span><strong>{trial.remaining?"무료 첨삭 1회 남음":"무료 첨삭 사용 완료"}</strong></div>{trial.remaining===1&&onUse&&<button className="button primary" onClick={onUse}>무료 첨삭 시작하기</button>}</>:<><form className="p-form p-margin-top" onSubmit={send}><label>휴대전화 번호<input required type="tel" autoComplete="tel" maxLength={40} value={phone} onChange={e=>{setPhone(e.target.value);setChallenge(null);setCode("");}} placeholder="010-1234-5678" disabled={busy||!trial.configured||demo}/></label><label className="p-check"><input type="checkbox" required checked={consent} onChange={e=>setConsent(e.target.checked)} disabled={busy||!trial.configured||demo}/><span>전화번호를 인증 및 무료 첨삭 중복 지급 방지에 이용하는 데 동의합니다. 번호는 문자 인증 서비스에 전달되며, 서비스에는 번호 전체 대신 마스킹 정보와 중복 확인용 값을 보관합니다.</span></label><button className="button secondary" disabled={busy||!trial.configured||demo||remaining>0||!consent}>{busy?"처리 중…":!trial.configured||demo?"문자 인증 연결 준비 중":remaining>0?`${remaining}초 후 재전송`:challenge?"인증번호 다시 받기":"인증번호 받기"}</button></form>{challenge&&<form className="p-form p-margin-top" onSubmit={verify}><label>{challenge.masked}로 받은 인증번호<input required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,""))} disabled={busy||expired}/></label>{expired&&<p className="p-error">인증 시간이 만료되었습니다. 인증 문자를 새로 요청하세요.</p>}<button className="button primary" disabled={busy||expired||code.length!==6}>인증하고 무료 첨삭 1회 받기</button></form>}{(!trial.configured||demo)&&<p className="p-help p-margin-top">{demo?"예시 작업대에서는 전화번호를 수집하거나 인증 문자를 보내지 않습니다.":"문자 인증 연결을 준비 중입니다. 연결 후 인증을 완료하면 무료 기회가 제공됩니다."}</p>}</>}{message&&<p role="status" className="p-margin-top">{message}</p>}{error&&<p className="p-error" role="alert">{error}</p>}</section>;
}

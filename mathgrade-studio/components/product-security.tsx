"use client";
import { useState, type FormEvent } from "react";
import type { AccountSettings } from "@/lib/product-types";
import { api } from "@/lib/client/api";

const errorText=(e:unknown)=>e instanceof Error ? e.message : "처리하지 못했습니다.";
export function RecoveryPanel({close}:{close:()=>void}) {
  const [purpose,setPurpose]=useState<"username"|"password">("username"),[phone,setPhone]=useState(""),[username,setUsername]=useState("");
  const [challenge,setChallenge]=useState(""),[code,setCode]=useState(""),[token,setToken]=useState(""),[password,setPassword]=useState(""),[confirm,setConfirm]=useState("");
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState("");
  async function submit(e:FormEvent) {
    e.preventDefault();if(busy)return;setBusy(true);setError("");
    try {
      if (token) {
        if (password!==confirm) throw new Error("새 비밀번호 확인이 일치하지 않습니다.");
        await api("/api/product/auth/reset-password",{resetToken:token,password});
        setToken("");setChallenge("");setPassword("");setConfirm("");setMessage("비밀번호를 재설정하고 기존의 모든 로그인을 종료했습니다. 새 비밀번호로 로그인하세요.");
      } else if (challenge) {
        const result=await api<{resetToken?:string;username?:string|null;providers?:string[]}>("/api/product/auth/recovery/verify",{challengeId:challenge,code});
        if (result.resetToken) {setToken(result.resetToken);setMessage("인증되었습니다. 5분 안에 새 비밀번호를 저장하세요.");}
        else {setChallenge("");setMessage(result.username ? `가입한 아이디: ${result.username}` : `소셜 전용 계정입니다. ${(result.providers??[]).join(" · ")} 로그인 또는 해당 제공자의 계정 복구를 이용하세요.`);}
      } else {
        const result=await api<{challengeId:string;message:string}>("/api/product/auth/recovery/start",{purpose,phone,username});
        setChallenge(result.challengeId);setMessage(result.message);
      }
    } catch(e){setError(errorText(e));} finally{setBusy(false);}
  }
  return <section className="p-recovery"><h2>아이디 · 비밀번호 찾기</h2><p className="p-help">이 계정에 미리 인증한 전화번호로 확인합니다. 번호 인증 이력이 없으면 이 경로로 복구할 수 없습니다. Google·카카오 전용 계정은 제공자의 로그인·계정 복구를 이용하세요.</p><form className="p-form" onSubmit={submit}><fieldset disabled={busy}><legend className="p-sr-only">계정 복구</legend>{!challenge&&!token&&<><label>찾을 항목<select value={purpose} onChange={e=>{setPurpose(e.target.value as typeof purpose);setMessage("");}}><option value="username">아이디 찾기</option><option value="password">비밀번호 재설정</option></select></label>{purpose==="password"&&<label>아이디<input required autoComplete="username" maxLength={40} value={username} onChange={e=>setUsername(e.target.value)}/></label>}<label>가입 계정에 인증한 전화번호<input required type="tel" autoComplete="tel" maxLength={40} value={phone} onChange={e=>setPhone(e.target.value)}/></label></>}{challenge&&!token&&<label>문자로 받은 인증번호<input required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={e=>setCode(e.target.value)}/></label>}{token&&<><label>새 비밀번호<input required type="password" autoComplete="new-password" minLength={10} maxLength={128} value={password} onChange={e=>setPassword(e.target.value)}/></label><label>새 비밀번호 확인<input required type="password" autoComplete="new-password" value={confirm} onChange={e=>setConfirm(e.target.value)}/></label></>}</fieldset>{message&&<p className="p-note" role="status">{message}</p>}{error&&<p className="p-error" role="alert">{error}</p>}<button className="button primary" disabled={busy}>{busy?"확인 중…":token?"비밀번호 재설정":challenge?"인증 확인":"인증 문자 요청"}</button>{challenge&&<button type="button" className="button secondary" disabled={busy} onClick={()=>{setChallenge("");setCode("");setError("");setMessage("문자는 요청 후 60초가 지나야 다시 보낼 수 있습니다.");}}>인증 다시 시작</button>}<button type="button" className="button ghost" disabled={busy} onClick={close}>로그인으로 돌아가기</button></form></section>;
}
export function SecurityPanel({settings,demo}:{settings:AccountSettings|null;demo:boolean}) {
  const [current,setCurrent]=useState(""),[password,setPassword]=useState(""),[confirm,setConfirm]=useState(""),[withdraw,setWithdraw]=useState(false),[confirmation,setConfirmation]=useState("");
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  const security=settings?.security;
  async function submit(e:FormEvent){
    e.preventDefault();if(busy||demo)return;setBusy(true);setError("");
    try {
      if (!withdraw&&password!==confirm) throw new Error("새 비밀번호 확인이 일치하지 않습니다.");
      await api(`/api/product/account/${withdraw?"withdraw":"password"}`,{currentPassword:current,password,confirmation});
      location.assign(withdraw?"/":"/login");
    } catch(e){setError(errorText(e));} finally{setBusy(false);}
  }
  return <section className="p-card p-card-body"><h2>계정 보안 · 회원 탈퇴</h2>{demo?<p className="p-note">가상 체험 계정에서는 비밀번호 변경과 회원 탈퇴를 실행하지 않습니다.</p>:!security?<p>계정 보안 정보를 불러오는 중입니다.</p>:<><p>{security.hasPassword?`가입한 아이디: ${security.username}`:"Google·카카오 전용 계정입니다. 비밀번호 변경·분실 복구는 해당 제공자에서 진행하세요."}</p><p className="p-help">비밀번호를 변경하거나 재설정하면 모든 기기의 기존 로그인이 종료됩니다.</p><div className="actions">{security.hasPassword&&<button type="button" className="button secondary" disabled={busy} onClick={()=>{setWithdraw(false);setError("");}}>비밀번호 변경</button>}<button type="button" className="button secondary" disabled={busy} onClick={()=>{setWithdraw(true);setError("");}}>회원 탈퇴</button></div>{(security.hasPassword||withdraw)&&<form className="p-form p-margin-top" onSubmit={submit}><fieldset disabled={busy}><legend>{withdraw?"회원 탈퇴":"비밀번호 변경"}</legend>{security.hasPassword&&<label>현재 비밀번호<input required type="password" autoComplete="current-password" maxLength={128} value={current} onChange={e=>setCurrent(e.target.value)}/></label>}{!withdraw&&<><label>새 비밀번호<input required type="password" autoComplete="new-password" minLength={10} maxLength={128} value={password} onChange={e=>setPassword(e.target.value)}/></label><label>새 비밀번호 확인<input required type="password" autoComplete="new-password" value={confirm} onChange={e=>setConfirm(e.target.value)}/></label></>}{withdraw&&<><p className="p-note">로그인과 반 소속을 종료하고 계정 이름·연결 정보를 정리합니다. 다른 학생과 공유한 시험 원본·첨삭 이력은 삭제하지 않고 작성자를 ‘탈퇴한 회원’으로 표시합니다. 자료의 보관·삭제 세부 정책과 기간은 운영 전 별도로 안내할 예정입니다.</p>{security.withdrawalBlockers.length>0&&<p className="p-error">탈퇴 전 반 담당·비용 부담을 인계하거나 운영을 마친 반을 보관하세요: {security.withdrawalBlockers.join(", ")}</p>}{!security.hasPassword&&<div><p>이미 연결한 소셜 계정으로 다시 인증한 뒤 5분 안에 탈퇴를 진행하세요.</p>{(settings?.links??[]).map(link=>settings?.providers[link.provider]?<a className="button secondary" key={link.provider} href={`/api/product/auth/${link.provider}?reauth=1`}>{link.provider==="google"?"Google":"카카오"} 본인 확인</a>:<p key={link.provider}>소셜 인증 연결을 준비 중입니다. 현재 탈퇴 인증을 실행할 수 없습니다.</p>)}</div>}<label>확인 문구<input required placeholder="회원 탈퇴" value={confirmation} onChange={e=>setConfirmation(e.target.value)}/></label></>}</fieldset>{error&&<p className="p-error" role="alert">{error}</p>}<button className="button primary" disabled={busy||(withdraw&&security.withdrawalBlockers.length>0)}>{busy?"처리 중…":withdraw?"본인 확인 후 회원 탈퇴":"새 비밀번호 저장 · 다시 로그인"}</button></form>}</>}</section>;
}

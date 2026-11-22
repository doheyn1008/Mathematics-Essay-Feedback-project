"use client";
import type { AccountMode } from "@/lib/product-types";

export const ownerModeNames: Record<AccountMode, string> = {
  teacher: "선생님",
  academy_student: "학원 학생",
  personal_basic: "개인 일반",
  personal_premium: "개인 프리미엄",
};

export function OwnerModeSelect({ mode, busy, onChange }: {
  mode: AccountMode; busy: boolean; onChange: (mode: AccountMode) => void;
}) {
  return <label className="owner-mode-control">
    <span>관리자 이용 모드</span>
    <select value={mode} disabled={busy} onChange={event => onChange(event.target.value as AccountMode)}>
      {(Object.keys(ownerModeNames) as AccountMode[]).map(key => <option key={key} value={key}>{ownerModeNames[key]}</option>)}
    </select>
  </label>;
}

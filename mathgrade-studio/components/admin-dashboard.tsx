"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowUpRight, ChevronLeft, ChevronRight, LockKeyhole, RefreshCw, Search, Users } from "lucide-react";
import type { AdminCustomerDetail, AdminCustomerList, CustomerRole } from "@/lib/admin-types";

const roleLabels: Record<CustomerRole, string> = {
  teacher: "선생님",
  academy_student: "학원 학생",
  personal: "개인 학습자",
};

const plans: Record<string, string> = {
  teacher: "선생님",
  personal_basic: "개인 기본",
  personal_premium: "개인 프리미엄",
};

const numbers = new Intl.NumberFormat("ko-KR");
const dates = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeZone: "Asia/Seoul" });

type Filters = { query: string; role: CustomerRole | "unassigned" | ""; page: number };
const initialFilters: Filters = { query: "", role: "", page: 1 };

class AdminApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = "AdminApiError";
  }
}

async function adminRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...options, credentials: "same-origin", cache: "no-store" });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const errorBody = body && typeof body === "object" ? body : {};
    const message = "error" in errorBody && typeof errorBody.error === "string"
      ? errorBody.error : "요청을 처리하지 못했습니다.";
    const code = "code" in errorBody && typeof errorBody.code === "string" ? errorBody.code : undefined;
    throw new AdminApiError(message, response.status, code);
  }
  if (body === null) throw new AdminApiError("관리자 서버의 응답을 확인하지 못했습니다.", 502);
  return body as T;
}

function isAccessError(error: AdminApiError | null): error is AdminApiError {
  return error?.status === 401 || error?.status === 403;
}

type QueryResult<T> = { data: T | null; error: AdminApiError | null; loading: boolean };

function useAdminQuery<T>(path: string, refresh: number, onAuthError: (error: AdminApiError) => void): QueryResult<T> {
  const key = `${path}:${refresh}`;
  const [result, setResult] = useState<{ key: string; data: T | null; error: AdminApiError | null } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    adminRequest<T>(path, { signal: controller.signal }).then(
      (data) => {
        if (!controller.signal.aborted) setResult({ key, data, error: null });
      },
      (cause: unknown) => {
        if (controller.signal.aborted) return;
        const error = cause instanceof AdminApiError
          ? cause : new AdminApiError("연결 상태를 확인하고 다시 시도해 주세요.", 0);
        if (isAccessError(error)) onAuthError(error);
        setResult({ key, data: null, error });
      },
    );
    return () => controller.abort();
  }, [path, key, onAuthError]);

  if (result?.key !== key) return { data: null, error: null, loading: true };
  return { data: result.data, error: result.error, loading: false };
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : dates.format(date);
}

function formatRole(role: CustomerRole | null): string {
  return role ? roleLabels[role] : "유형 미등록";
}

function Initial({ name, large = false }: { name: string; large?: boolean }) {
  return <span className={`mg-admin-initial${large ? " large" : ""}`} aria-hidden="true">{Array.from(name.trim())[0] || "회원"}</span>;
}

function QueryState({ loading, error, onRetry }: { loading: boolean; error: AdminApiError | null; onRetry(): void }) {
  if (loading) return <div className="mg-admin-state" role="status">불러오는 중…</div>;
  if (!error) return null;
  return (
    <div className="mg-admin-state">
      <p role="alert">{error.message}</p>
      <button type="button" className="mg-admin-button" onClick={onRetry}>
        <RefreshCw size={15} aria-hidden="true" />다시 시도
      </button>
    </div>
  );
}

function AccessView({ error, signInUrl }: { error: AdminApiError; signInUrl: string }) {
  const needsLogin = error.status === 401;
  return (
    <div className="mg-admin-state access">
      <section className="mg-admin-access-card" aria-labelledby="admin-access-title">
        <LockKeyhole size={28} aria-hidden="true" />
        <h1 id="admin-access-title">{needsLogin ? "관리자 로그인이 필요합니다" : "관리자 권한이 필요합니다"}</h1>
        <p>{needsLogin ? "수식채점실 사이트를 소유한 ChatGPT 계정으로 로그인해 주세요." : "이 계정으로는 수식채점실 관리자 센터에 접근할 수 없습니다."}</p>
        <div className="mg-admin-actions">
          <a className="mg-admin-button" href="/">수식채점실로 이동</a>
          {needsLogin && <a className="mg-admin-button primary" href={signInUrl} target="_top">ChatGPT로 로그인</a>}
        </div>
      </section>
    </div>
  );
}

function CustomerDirectory({ filters, updateFilters, onSelect, onAuthError }: {
  filters: Filters;
  updateFilters(filters: Filters): void;
  onSelect(id: string): void;
  onAuthError(error: AdminApiError): void;
}) {
  const [query, setQuery] = useState(filters.query);
  const [refresh, setRefresh] = useState(0);
  const params = new URLSearchParams({ query: filters.query, role: filters.role, page: String(filters.page) });
  const { data, error, loading } = useAdminQuery<AdminCustomerList>(`/api/admin/customers?${params}`, refresh, onAuthError);
  const pageCount = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    updateFilters({ ...filters, query: query.trim(), page: 1 });
  }

  return (
    <>
      <h1 className="mg-admin-page-title">회원 관리</h1>
      <section className="mg-admin-card" aria-label="회원 목록">
        <form className="mg-admin-filter" onSubmit={search}>
          <label className="mg-admin-field search">
            <span>회원 검색</span>
            <span className="mg-admin-search-wrap">
              <Search size={16} aria-hidden="true" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="이름 또는 아이디" maxLength={100} />
            </span>
          </label>
          <label className="mg-admin-field">
            <span>계정 유형</span>
            <select value={filters.role} onChange={(event) => updateFilters({ ...filters, query: query.trim(), role: event.target.value as Filters["role"], page: 1 })}>
              <option value="">전체 유형</option>
              {Object.entries(roleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              <option value="unassigned">유형 미등록</option>
            </select>
          </label>
          <button type="submit" className="mg-admin-button primary">검색</button>
        </form>
        {data ? (
          <>
            {data.items.length ? (
              <div className="mg-admin-table-wrap">
                <table className="mg-admin-table">
                  <caption className="mg-admin-screenreader">수식채점실 회원 검색 결과</caption>
                  <thead><tr><th scope="col">회원</th><th scope="col">계정 유형</th><th scope="col">가입일</th><th scope="col">상세</th></tr></thead>
                  <tbody>
                    {data.items.map((customer) => (
                      <tr key={customer.id}>
                        <td>
                          <div className="mg-admin-customer-cell">
                            <Initial name={customer.name} />
                            <div><strong>{customer.name}</strong>{customer.username && <span className="mg-admin-cell-sub">{customer.username}</span>}</div>
                          </div>
                        </td>
                        <td>{formatRole(customer.role)}</td>
                        <td>{formatDate(customer.createdAt)}</td>
                        <td>
                          <button type="button" className="mg-admin-button plain small" aria-label={`${customer.name} 회원 상세`} onClick={() => onSelect(customer.id)}>
                            <ChevronRight size={17} aria-hidden="true" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="mg-admin-state"><Users size={22} aria-hidden="true" /><p>{filters.query || filters.role ? "조건에 맞는 회원이 없습니다." : "아직 가입한 회원이 없습니다."}</p></div>
            )}
            <div className="mg-admin-pager">
              <span role="status">회원 {numbers.format(data.total)}명</span>
              <div className="mg-admin-pager-buttons">
                <button type="button" className="mg-admin-button small" aria-label="이전 페이지" disabled={data.page <= 1} onClick={() => updateFilters({ ...filters, page: data.page - 1 })}><ChevronLeft size={15} aria-hidden="true" /></button>
                <span>{numbers.format(data.page)} / {numbers.format(pageCount)}</span>
                <button type="button" className="mg-admin-button small" aria-label="다음 페이지" disabled={data.page >= pageCount} onClick={() => updateFilters({ ...filters, page: data.page + 1 })}><ChevronRight size={15} aria-hidden="true" /></button>
              </div>
            </div>
          </>
        ) : <QueryState loading={loading} error={error} onRetry={() => setRefresh((value) => value + 1)} />}
      </section>
    </>
  );
}

function EntitlementDescription({ entitlement }: { entitlement: AdminCustomerDetail["customer"]["entitlement"] }) {
  if (!entitlement) return <span>이용권 없음</span>;
  return (
    <>
      <span>{plans[entitlement.plan] || entitlement.plan} · {entitlement.status === "active" ? "활성" : "비활성"}</span>
      {entitlement.expiresAt && <span className="mg-admin-cell-sub">만료 {formatDate(entitlement.expiresAt)}</span>}
    </>
  );
}

function RoleForm({ customer, onSaved, onReload, onAuthError }: {
  customer: AdminCustomerDetail["customer"];
  onSaved(data: AdminCustomerDetail): void;
  onReload(): void;
  onAuthError(error: AdminApiError): void;
}) {
  const [role, setRole] = useState(customer.role);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState("");
  const savingRef = useRef(false);
  const changed = role !== null && role !== customer.role;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!changed || conflict || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      const data = await adminRequest<AdminCustomerDetail>(`/api/admin/customers/${encodeURIComponent(customer.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, revision: customer.revision }),
      });
      onSaved(data);
    } catch (cause) {
      if (cause instanceof AdminApiError) {
        if (isAccessError(cause)) onAuthError(cause);
        if (cause.code === "CUSTOMER_REVISION_CONFLICT") setConflict(true);
        setError(cause.message);
      } else {
        setError("연결 상태를 확인하고 저장을 다시 시도해 주세요.");
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <form className="mg-admin-role-form" onSubmit={save}>
      <h2>계정 유형 변경</h2>
      <label className="mg-admin-field">
        <span>계정 유형</span>
        <select value={role ?? ""} disabled={saving || conflict} onChange={(event) => {
          setRole((event.target.value || null) as CustomerRole | null);
          setError("");
        }} aria-describedby="mg-admin-role-hint">
          {customer.role === null && <option value="">유형 미등록</option>}
          {Object.entries(roleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <p id="mg-admin-role-hint" className="mg-admin-hint">계정 유형에 따라 이용할 수 있는 기능이 달라집니다. 유료 이용권은 별도로 관리합니다.</p>
      {changed && <p className="mg-admin-notice" role="status"><strong>저장할 변경</strong> · {formatRole(customer.role)} → {formatRole(role)}</p>}
      {error && <p className="mg-admin-notice error" role="alert">{error}</p>}
      <div className="mg-admin-actions">
        {conflict && <button type="button" className="mg-admin-button" onClick={onReload}>최신 정보 불러오기</button>}
        <button type="submit" className="mg-admin-button primary" disabled={!changed || saving || conflict}>{saving ? "저장 중…" : "계정 유형 변경 저장"}</button>
      </div>
    </form>
  );
}

function CustomerDetail({ id, onBack, onAuthError }: { id: string; onBack(): void; onAuthError(error: AdminApiError): void }) {
  const [refresh, setRefresh] = useState(0);
  const [saved, setSaved] = useState<AdminCustomerDetail | null>(null);
  const query = useAdminQuery<AdminCustomerDetail>(`/api/admin/customers/${encodeURIComponent(id)}`, refresh, onAuthError);
  const customer = (saved ?? query.data)?.customer;

  function reload() {
    setSaved(null);
    setRefresh((value) => value + 1);
  }

  return (
    <>
      <button className="mg-admin-button plain" onClick={onBack} type="button"><ArrowLeft size={15} aria-hidden="true" /> 회원 목록</button>
      <section className="mg-admin-card mg-admin-detail" aria-label="회원 상세">
        {customer ? (
          <>
            <div className="mg-admin-detail-head">
              <Initial name={customer.name} large />
              <div><h1>{customer.name}</h1><p>{formatRole(customer.role)}{customer.username && ` · ${customer.username}`}</p></div>
            </div>
            {saved && <p className="mg-admin-notice success" role="status">계정 유형을 변경했습니다.</p>}
            <dl className="mg-admin-definition">
              <div><dt>아이디</dt><dd>{customer.username || "—"}</dd></div>
              <div><dt>가입일</dt><dd>{formatDate(customer.createdAt)}</dd></div>
              <div><dt>전화번호 인증</dt><dd>{customer.phoneVerified ? "인증 완료" : "미인증"}</dd></div>
              <div><dt>이용권</dt><dd><EntitlementDescription entitlement={customer.entitlement} /></dd></div>
            </dl>
            <RoleForm key={customer.revision} customer={customer} onSaved={setSaved} onReload={reload} onAuthError={onAuthError} />
          </>
        ) : <QueryState loading={query.loading} error={query.error} onRetry={reload} />}
      </section>
    </>
  );
}

export function AdminDashboard({ signInUrl }: { signInUrl: string }) {
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [authError, setAuthError] = useState<AdminApiError | null>(null);
  const main = useRef<HTMLElement>(null);

  function showCustomer(id: string | null) {
    setCustomerId(id);
    window.scrollTo(0, 0);
    main.current?.focus({ preventScroll: true });
  }

  return (
    <div className="mg-admin">
      {authError ? <AccessView error={authError} signInUrl={signInUrl} /> : (
        <>
          <header className="mg-admin-topbar">
            <div className="mg-admin-topbar-inner">
              <a className="mg-admin-brand" href="/admin">
                <span className="mg-admin-mark" aria-hidden="true">∑</span>
                <span><strong>수식채점실</strong><small>관리자 센터</small></span>
              </a>
              <a className="mg-admin-button" href="/">수식채점실로 이동 <ArrowUpRight size={16} aria-hidden="true" /></a>
            </div>
          </header>
          <main className="mg-admin-content" tabIndex={-1} ref={main}>
            {customerId ? (
              <CustomerDetail key={customerId} id={customerId} onBack={() => showCustomer(null)} onAuthError={setAuthError} />
            ) : <CustomerDirectory filters={filters} updateFilters={setFilters} onSelect={showCustomer} onAuthError={setAuthError} />}
          </main>
        </>
      )}
    </div>
  );
}

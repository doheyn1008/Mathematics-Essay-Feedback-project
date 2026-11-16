"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  ArrowLeft, ArrowUpRight, Bell, ChevronLeft, ChevronRight, ClipboardList, FileText,
  LayoutDashboard, LockKeyhole, RefreshCw, Search, ShieldCheck, Users, UsersRound,
} from "lucide-react";
import type {
  AdminClassSummary, AdminCustomer, AdminCustomerDetail, AdminCustomerList, AdminDashboardData,
  AdminSubmissionSummary, CustomerRole, CustomerStatus,
} from "@/lib/admin-types";

const navigation = [
  { key: "overview", label: "운영 현황", icon: LayoutDashboard },
  { key: "customers", label: "회원 관리", icon: Users },
  { key: "classes", label: "반 현황", icon: UsersRound },
  { key: "submissions", label: "제출 현황", icon: ClipboardList },
] as const;

type AdminView = (typeof navigation)[number]["key"];

const roleLabels: Record<CustomerRole, string> = {
  teacher: "선생님",
  academy_student: "학원 학생",
  personal: "개인 회원",
};

const statusLabels: Record<CustomerStatus, string> = {
  new: "신규",
  active: "관리 중",
  follow_up: "후속 확인",
  closed: "관리 완료",
};

const processingLabels: Record<AdminSubmissionSummary["processing"], string> = {
  not_configured: "AI 미연결",
  ready: "대기 중",
  processing: "처리 중",
  completed: "완료",
  failed: "처리 실패",
};

const plans: Record<string, string> = {
  teacher: "선생님",
  personal_basic: "개인 기본",
  personal_premium: "개인 프리미엄",
};

const numberFormat = new Intl.NumberFormat("ko-KR");
const dateFormat = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeZone: "Asia/Seoul" });
const timeFormat = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" });

type Filters = { query: string; role: CustomerRole | "unassigned" | ""; status: CustomerStatus | ""; page: number };
const emptyFilters: Filters = { query: "", role: "", status: "", page: 1 };
const noteLimit = 2000;

class AdminApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "AdminApiError";
  }
}

async function adminRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...options, credentials: "same-origin", cache: "no-store" });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = body && typeof body === "object" && "error" in body && typeof body.error === "string"
      ? body.error : "관리자 데이터를 불러오지 못했습니다.";
    throw new AdminApiError(detail, response.status);
  }
  if (body === null) {
    throw new AdminApiError("관리자 서버의 응답을 확인하지 못했습니다.", 502);
  }
  return body as T;
}

type QueryResult<T> = { data: T | null; error: AdminApiError | null; loading: boolean };

function useAdminQuery<T>(path: string | null, revision: number): QueryResult<T> {
  const key = path ? `${path}:${revision}` : null;
  const [result, setResult] = useState<QueryResult<T> & { key: string }>({
    key: "", data: null, error: null, loading: true,
  });

  useEffect(() => {
    if (!path || !key) return;
    const controller = new AbortController();
    adminRequest<T>(path, { signal: controller.signal }).then(
      (data) => {
        if (!controller.signal.aborted) setResult({ key, data, error: null, loading: false });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) {
          const reported = error instanceof AdminApiError ? error : new AdminApiError("연결 상태를 확인하고 다시 시도해 주세요.", 0);
          setResult({ key, data: null, error: reported, loading: false });
        }
      },
    );
    return () => controller.abort();
  }, [path, key]);

  if (!key || key !== result.key) return { data: null, error: null, loading: Boolean(key) };
  return result;
}

function formatDate(value: string | null, withTime = false): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return (withTime ? timeFormat : dateFormat).format(date);
}

function formatCount(value: number): string {
  return numberFormat.format(value);
}

function StatusPill({ status }: { status: CustomerStatus }) {
  return <span className="mg-admin-pill" data-tone={status}>{statusLabels[status]}</span>;
}

function Initial({ name, large = false }: { name: string; large?: boolean }) {
  return <span className={`mg-admin-initial${large ? " large" : ""}`} aria-hidden="true">{Array.from(name.trim())[0] || "회원"}</span>;
}

function EmptyState({ message }: { message: string }) {
  return <div className="mg-admin-state"><FileText size={22} aria-hidden="true" /><p>{message}</p></div>;
}

function QueryState({ loading, error, onRetry }: { loading: boolean; error: AdminApiError | null; onRetry(): void }) {
  if (loading) return <div className="mg-admin-state" role="status">불러오는 중…</div>;
  if (!error) return null;
  return (
    <div className="mg-admin-state">
      <p role="alert">{error.message}</p>
      <button type="button" className="mg-admin-button" onClick={onRetry}><RefreshCw size={15} aria-hidden="true" />다시 시도</button>
    </div>
  );
}

function AccessView({ error, signInUrl }: { error: AdminApiError; signInUrl: string }) {
  return (
    <div className="mg-admin-state access">
      <section className="mg-admin-access-card" aria-labelledby="admin-access-title">
        <LockKeyhole size={28} aria-hidden="true" />
        <h1 id="admin-access-title">{error.status === 401 ? "관리자 로그인이 필요합니다" : "관리자 권한이 필요합니다"}</h1>
        <p>{error.status === 401 ? "수식채점실 사이트를 소유한 ChatGPT 계정으로 로그인해 주세요." : "이 계정으로는 수식채점실 관리자 센터에 접근할 수 없습니다."}</p>
        <div className="mg-admin-actions">
          <a className="mg-admin-button" href="/">수식채점실로 이동</a>
          {error.status === 401 && <a className="mg-admin-button primary" href={signInUrl} target="_top">ChatGPT로 로그인</a>}
        </div>
      </section>
    </div>
  );
}

function Card({ title, description, action, children }: { title: string; description?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="mg-admin-card">
      <div className="mg-admin-card-head">
        <div><h2>{title}</h2>{description && <p>{description}</p>}</div>
        {action}
      </div>
      {children}
    </section>
  );
}

function IconDetailButton({ customer, onSelect }: { customer: AdminCustomer; onSelect(id: string): void }) {
  return (
    <button type="button" className="mg-admin-button plain small" aria-label={`${customer.name} 회원 상세`} onClick={() => onSelect(customer.id)}>
      <ChevronRight size={17} aria-hidden="true" />
    </button>
  );
}

function RecentCustomers({ customers, onSelect }: { customers: AdminCustomer[]; onSelect(id: string): void }) {
  if (!customers.length) return <EmptyState message="아직 가입한 회원이 없습니다." />;
  return (
    <ul className="mg-admin-rows">
      {customers.map((customer) => (
        <li key={customer.id} className="mg-admin-row">
          <Initial name={customer.name} />
          <div className="mg-admin-row-main">
            <strong>{customer.name}</strong>
            <span>{customer.role ? roleLabels[customer.role] : "역할 미등록"} · {formatDate(customer.createdAt)}</span>
          </div>
          <StatusPill status={customer.status} />
          <IconDetailButton customer={customer} onSelect={onSelect} />
        </li>
      ))}
    </ul>
  );
}

function RecentSubmissions({ submissions }: { submissions: AdminSubmissionSummary[] }) {
  if (!submissions.length) return <EmptyState message="아직 제출된 답안이 없습니다." />;
  return (
    <ul className="mg-admin-rows">
      {submissions.map((submission) => (
        <li key={submission.id} className="mg-admin-row">
          <span className="mg-admin-metric-icon" aria-hidden="true"><FileText size={16} /></span>
          <div className="mg-admin-row-main">
            <strong>{submission.title}</strong>
            <span>{submission.className || "개인 제출"} · {formatDate(submission.createdAt, true)}</span>
          </div>
          <div className="mg-admin-row-meta">
            <span className="mg-admin-pill" data-tone={submission.reviewStatus === "reviewed" ? "active" : "follow_up"}>
              {submission.reviewStatus === "reviewed" ? "검토 완료" : "검토 전"}
            </span>
            <span className="mg-admin-cell-sub">{processingLabels[submission.processing]}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function RecentClasses({ classes }: { classes: AdminClassSummary[] }) {
  if (!classes.length) return <EmptyState message="아직 생성된 반이 없습니다." />;
  return (
    <ul className="mg-admin-rows">
      {classes.map((item) => (
        <li key={item.id} className="mg-admin-row">
          <span className="mg-admin-metric-icon" aria-hidden="true"><UsersRound size={16} /></span>
          <div className="mg-admin-row-main"><strong>{item.name}</strong><span>개설 {formatDate(item.createdAt)}</span></div>
          <span className="mg-admin-row-meta">선생님 {formatCount(item.teachers)}명 · 학생 {formatCount(item.students)}명</span>
        </li>
      ))}
    </ul>
  );
}

function Overview({ data, goTo, onCustomer }: { data: AdminDashboardData; goTo(view: AdminView): void; onCustomer(id: string): void }) {
  const { metrics } = data;
  const cards = [
    { label: "전체 회원", value: `${formatCount(metrics.customers)}명`, info: `신규 관리 ${formatCount(metrics.newCustomers)}명`, icon: Users },
    { label: "후속 확인", value: `${formatCount(metrics.followUpCustomers)}명`, info: "회원 관리의 후속 확인 상태", icon: Bell },
    { label: "전체 반", value: `${formatCount(metrics.classes)}개`, info: "수식채점실에 등록한 반", icon: UsersRound },
    { label: "전체 제출", value: `${formatCount(metrics.submissions)}건`, info: `반 제출 검토 전 ${formatCount(metrics.pendingReviews)}건`, icon: ClipboardList },
  ];
  return (
    <>
      <div className="mg-admin-metrics" aria-label="운영 지표">
        {cards.map(({ label, value, info, icon: Icon }) => (
          <section className="mg-admin-metric" key={label}>
            <div className="mg-admin-metric-top"><span>{label}</span><div className="mg-admin-metric-icon"><Icon size={17} aria-hidden="true" /></div></div>
            <strong className="mg-admin-metric-value">{value}</strong>
            <small>{info}</small>
          </section>
        ))}
      </div>
      <div className="mg-admin-grid">
        <div className="mg-admin-stack">
          <Card title="최근 제출" action={<button className="mg-admin-button plain small" type="button" onClick={() => goTo("submissions")}>제출 현황 <ChevronRight size={15} aria-hidden="true" /></button>}>
            <RecentSubmissions submissions={data.recentSubmissions.slice(0, 5)} />
          </Card>
          <Card title="최근 개설한 반" action={<button className="mg-admin-button plain small" type="button" onClick={() => goTo("classes")}>반 현황 <ChevronRight size={15} aria-hidden="true" /></button>}>
            <RecentClasses classes={data.recentClasses.slice(0, 4)} />
          </Card>
        </div>
        <Card title="최근 가입 회원" action={<button className="mg-admin-button plain small" type="button" onClick={() => goTo("customers")}>회원 관리 <ChevronRight size={15} aria-hidden="true" /></button>}>
          <RecentCustomers customers={data.recentCustomers.slice(0, 6)} onSelect={onCustomer} />
        </Card>
      </div>
    </>
  );
}

function Customers({ filters, revision, updateFilters, onCustomer, onAuthError, retry }: {
  filters: Filters;
  revision: number;
  updateFilters(filters: Filters): void;
  onCustomer(id: string): void;
  onAuthError(error: AdminApiError): void;
  retry(): void;
}) {
  const [query, setQuery] = useState(filters.query);
  const params = new URLSearchParams({ query: filters.query, role: filters.role, status: filters.status, page: String(filters.page) });
  const { data, error, loading } = useAdminQuery<AdminCustomerList>(`/api/admin/customers?${params}`, revision);
  useEffect(() => {
    if (error?.status === 401 || error?.status === 403) onAuthError(error);
  }, [error, onAuthError]);

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    updateFilters({ ...filters, query: query.trim(), page: 1 });
  }

  const pageCount = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  return (
    <section className="mg-admin-card" aria-label="회원 목록">
      <form className="mg-admin-filter" onSubmit={applyFilters}>
        <label className="mg-admin-field search" htmlFor="mg-admin-search">
          <span>회원 검색</span>
          <span className="mg-admin-search-wrap">
            <Search size={16} aria-hidden="true" />
            <input id="mg-admin-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="이름 또는 아이디" maxLength={100} />
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
        <label className="mg-admin-field">
          <span>관리 상태</span>
          <select value={filters.status} onChange={(event) => updateFilters({ ...filters, query: query.trim(), status: event.target.value as Filters["status"], page: 1 })}>
            <option value="">전체 상태</option>
            {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
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
                <thead><tr><th scope="col">회원</th><th scope="col">계정 유형</th><th scope="col">가입일</th><th scope="col">관리 상태</th><th scope="col">상세</th></tr></thead>
                <tbody>
                  {data.items.map((customer) => (
                    <tr key={customer.id}>
                      <td><div className="mg-admin-customer-cell"><Initial name={customer.name} /><div><strong>{customer.name}</strong>{customer.username && <span className="mg-admin-cell-sub">{customer.username}</span>}</div></div></td>
                      <td>{customer.role ? roleLabels[customer.role] : "미등록"}</td>
                      <td>{formatDate(customer.createdAt)}</td>
                      <td><StatusPill status={customer.status} /></td>
                      <td><IconDetailButton customer={customer} onSelect={onCustomer} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <EmptyState message={filters.query || filters.role || filters.status ? "조건에 맞는 회원이 없습니다." : "아직 가입한 회원이 없습니다."} />}
          <div className="mg-admin-pager">
            <span role="status">회원 {formatCount(data.total)}명</span>
            <div className="mg-admin-pager-buttons">
              <button type="button" className="mg-admin-button small" aria-label="이전 페이지" disabled={data.page <= 1} onClick={() => updateFilters({ ...filters, page: data.page - 1 })}><ChevronLeft size={15} aria-hidden="true" /></button>
              <span>{formatCount(data.page)} / {formatCount(pageCount)}</span>
              <button type="button" className="mg-admin-button small" aria-label="다음 페이지" disabled={data.page >= pageCount} onClick={() => updateFilters({ ...filters, page: data.page + 1 })}><ChevronRight size={15} aria-hidden="true" /></button>
            </div>
          </div>
        </>
      ) : <QueryState loading={loading} error={error} onRetry={retry} />}
    </section>
  );
}

function EntitlementDescription({ entitlement }: { entitlement: AdminCustomerDetail["customer"]["entitlement"] }) {
  if (!entitlement) return <span>이용권 없음</span>;
  return (
    <>
      <span>{plans[entitlement.plan] || entitlement.plan} · {entitlement.status === "active" ? "활성" : "비활성"}</span>
      {entitlement.expiresAt && <span className="mg-admin-cell-sub">만료 {formatDate(entitlement.expiresAt)}</span>}
      <span className="mg-admin-cell-sub">첨삭 사용 {formatCount(entitlement.used)}회{entitlement.analysisLimit !== null && ` / ${formatCount(entitlement.analysisLimit)}회`}</span>
    </>
  );
}

function CustomerEdit({ customer, history, onSaved, onReload, onAuthError }: {
  customer: AdminCustomerDetail["customer"];
  history: AdminCustomerDetail["history"];
  onSaved(data: AdminCustomerDetail): void;
  onReload(): void;
  onAuthError(error: AdminApiError): void;
}) {
  const [status, setStatus] = useState(customer.status);
  const [note, setNote] = useState(customer.note);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState("");
  const saveInProgress = useRef(false);
  const changed = status !== customer.status || note !== customer.note;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || saveInProgress.current || !changed || conflict) return;
    saveInProgress.current = true;
    setSaving(true);
    setError("");
    try {
      const data = await adminRequest<AdminCustomerDetail>(`/api/admin/customers/${encodeURIComponent(customer.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, note, revision: customer.revision }),
      });
      onSaved(data);
    } catch (cause) {
      if (cause instanceof AdminApiError) {
        if (cause.status === 401 || cause.status === 403) onAuthError(cause);
        if (cause.status === 409) setConflict(true);
        setError(cause.message);
      } else {
        setError("연결 상태를 확인하고 저장을 다시 시도해 주세요.");
      }
    } finally {
      saveInProgress.current = false;
      setSaving(false);
    }
  }

  return (
    <div className="mg-admin-stack">
      <Card title="고객 관리" description="관리 상태와 내부 메모는 관리자만 확인할 수 있습니다.">
        <form className="mg-admin-card-body mg-admin-follow-up-form" onSubmit={save}>
          <label className="mg-admin-field">
            <span>관리 상태</span>
            <select value={status} onChange={(event) => setStatus(event.target.value as CustomerStatus)} disabled={saving}>
              {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <p className="mg-admin-edit-hint">문의 대응을 위한 내부 상태입니다.</p>
          <label className="mg-admin-field">
            <span>내부 메모</span>
            <textarea value={note} maxLength={noteLimit} onChange={(event) => setNote(event.target.value)} disabled={saving} rows={5} placeholder="문의 현황과 다음에 확인할 내용을 기록하세요." />
          </label>
          {error && <p className="mg-admin-notice error" role="alert">{error}</p>}
          {conflict && <button type="button" className="mg-admin-button" onClick={onReload}>입력을 버리고 최신 정보 불러오기</button>}
          <div className="mg-admin-form-footer">
            <small>{formatCount(note.length)} / {formatCount(noteLimit)}</small>
            <button type="submit" className="mg-admin-button primary" disabled={!changed || saving || conflict}>{saving ? "저장 중…" : "관리 기록 저장"}</button>
          </div>
          {customer.updatedAt && <p className="mg-admin-edit-hint">마지막 수정 {formatDate(customer.updatedAt, true)}</p>}
        </form>
      </Card>
      <Card title="관리 이력">
        {history.length ? (
          <ul className="mg-admin-rows">
            {history.map((entry) => (
              <li key={entry.id} className="mg-admin-row">
                <div className="mg-admin-row-main"><strong>{entry.actorName}</strong><time dateTime={entry.createdAt}>{formatDate(entry.createdAt, true)}</time></div>
                <StatusPill status={entry.status} />
              </li>
            ))}
          </ul>
        ) : <EmptyState message="아직 관리 기록 변경 이력이 없습니다." />}
      </Card>
    </div>
  );
}

function CustomerDetail({ id, onBack, onAuthError, onChange }: {
  id: string;
  onBack(): void;
  onAuthError(error: AdminApiError): void;
  onChange(): void;
}) {
  const [revision, setRevision] = useState(0);
  const [saved, setSaved] = useState<AdminCustomerDetail | null>(null);
  const [notice, setNotice] = useState("");
  const query = useAdminQuery<AdminCustomerDetail>(`/api/admin/customers/${encodeURIComponent(id)}`, revision);
  useEffect(() => {
    if (query.error?.status === 401 || query.error?.status === 403) onAuthError(query.error);
  }, [query.error, onAuthError]);

  function reload() {
    setSaved(null);
    setNotice("");
    setRevision((current) => current + 1);
  }

  function update(data: AdminCustomerDetail) {
    setSaved(data);
    setNotice("관리 기록을 저장했습니다.");
    onChange();
  }

  const data = saved ?? query.data;
  return (
    <>
      <button className="mg-admin-button plain small" onClick={onBack} type="button"><ArrowLeft size={15} aria-hidden="true" /> 회원 목록으로</button>
      {data ? (
        <>
          <div className="mg-admin-page-head">
            <div className="mg-admin-detail-head">
              <Initial name={data.customer.name} large />
              <div><h1>{data.customer.name}</h1><p>{data.customer.role ? roleLabels[data.customer.role] : "계정 유형 미등록"}{data.customer.username && ` · ${data.customer.username}`}</p></div>
            </div>
            <StatusPill status={data.customer.status} />
          </div>
          {notice && <p className="mg-admin-notice success mg-admin-page-notice" role="status">{notice}</p>}
          <div className="mg-admin-grid">
            <div className="mg-admin-stack">
              <Card title="회원 정보">
                <div className="mg-admin-card-body">
                  <dl className="mg-admin-definition">
                    <div><dt>이름</dt><dd>{data.customer.name}</dd></div>
                    <div><dt>아이디</dt><dd>{data.customer.username || "—"}</dd></div>
                    <div><dt>가입일</dt><dd>{formatDate(data.customer.createdAt, true)}</dd></div>
                    <div><dt>전화번호 인증</dt><dd>{data.customer.phoneVerified ? "인증 완료" : "미인증"}</dd></div>
                    <div><dt>이용권</dt><dd><EntitlementDescription entitlement={data.customer.entitlement} /></dd></div>
                    <div><dt>포인트 잔액</dt><dd>{formatCount(data.customer.points)} P</dd></div>
                  </dl>
                </div>
              </Card>
              <Card title="소속 반">
                {data.memberships.length ? (
                  <ul className="mg-admin-rows">
                    {data.memberships.map((item) => (
                      <li key={item.id} className="mg-admin-row">
                        <div className="mg-admin-row-main"><strong>{item.name}</strong><span>참여 {formatDate(item.joinedAt)}</span></div>
                        <span className="mg-admin-pill">{item.role === "teacher" ? "담당 선생님" : "학생"}</span>
                      </li>
                    ))}
                  </ul>
                ) : <EmptyState message="소속된 반이 없습니다." />}
              </Card>
              <Card title="최근 제출"><RecentSubmissions submissions={data.recentSubmissions} /></Card>
            </div>
            <CustomerEdit key={`${data.customer.id}:${data.customer.revision}`} customer={data.customer} history={data.history} onSaved={update} onReload={reload} onAuthError={onAuthError} />
          </div>
        </>
      ) : <QueryState loading={query.loading} error={query.error} onRetry={reload} />}
    </>
  );
}

export function AdminDashboard({ signInUrl }: { signInUrl: string }) {
  const [view, setView] = useState<AdminView>("overview");
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [revision, setRevision] = useState(0);
  const [authError, setAuthError] = useState<AdminApiError | null>(null);
  const dashboard = useAdminQuery<AdminDashboardData>(authError ? null : "/api/admin/dashboard", revision);
  const mainRef = useRef<HTMLElement>(null);
  const refresh = useCallback(() => setRevision((current) => current + 1), []);
  const selectNav = navigation.find((item) => item.key === view)!;
  const forbidden = authError ?? (dashboard.error?.status === 401 || dashboard.error?.status === 403 ? dashboard.error : null);

  function navigate(next: AdminView) {
    setCustomerId(null);
    setView(next);
    window.scrollTo(0, 0);
    mainRef.current?.focus({ preventScroll: true });
  }

  function showCustomer(id: string) {
    navigate("customers");
    setCustomerId(id);
  }

  const descriptions: Record<AdminView, string> = {
    overview: "수식채점실 회원과 반 운영, 답안 제출을 한눈에 확인하세요.",
    customers: "가입한 회원을 검색하고 문의 대응과 후속 확인을 기록하세요.",
    classes: "수식채점실에 최근 개설한 반과 소속 인원입니다.",
    submissions: "최근 접수된 제출과 검토·처리 상태입니다.",
  };

  if (forbidden) return <div className="mg-admin"><AccessView error={forbidden} signInUrl={signInUrl} /></div>;

  return (
    <div className="mg-admin">
      <div className="mg-admin-shell">
        <aside className="mg-admin-sidebar">
          <button type="button" className="mg-admin-brand" onClick={() => navigate("overview")}>
            <span className="mg-admin-mark" aria-hidden="true">∑</span>
            <span><strong>수식채점실</strong><small>관리자 센터</small></span>
          </button>
          <nav className="mg-admin-nav" aria-label="관리자 메뉴">
            {navigation.map(({ key, label, icon: Icon }) => (
              <button key={key} type="button" className="mg-admin-nav-item" aria-current={view === key ? "page" : undefined} onClick={() => navigate(key)}>
                <Icon size={18} aria-hidden="true" />{label}
              </button>
            ))}
          </nav>
          <div className="mg-admin-sidebar-foot"><a href="/" className="mg-admin-nav-item"><ArrowUpRight size={18} aria-hidden="true" /> 수식채점실</a></div>
        </aside>
        <div className="mg-admin-main">
          <header className="mg-admin-topbar">
            <div className="mg-admin-trail"><span>관리자 센터</span><ChevronRight size={13} aria-hidden="true" /><strong>{selectNav.label}</strong>{customerId && <><ChevronRight size={13} aria-hidden="true" /><span>회원 상세</span></>}</div>
            <span className="mg-admin-admin-id"><ShieldCheck size={16} aria-hidden="true" />관리자 전용</span>
          </header>
          <main className="mg-admin-content" tabIndex={-1} ref={mainRef}>
            {customerId ? (
              <CustomerDetail key={customerId} id={customerId} onBack={() => navigate("customers")} onAuthError={setAuthError} onChange={refresh} />
            ) : (
              <>
                <div className="mg-admin-page-head">
                  <div><h1>{selectNav.label}</h1><p>{descriptions[view]}</p></div>
                  <button type="button" className="mg-admin-button" onClick={refresh} disabled={dashboard.loading}><RefreshCw size={15} aria-hidden="true" />새로고침</button>
                </div>
                {view === "customers" ? (
                  <Customers filters={filters} revision={revision} updateFilters={setFilters} onCustomer={showCustomer} onAuthError={setAuthError} retry={refresh} />
                ) : dashboard.data ? (
                  <>
                    {view === "overview" && <Overview data={dashboard.data} goTo={navigate} onCustomer={showCustomer} />}
                    {view === "classes" && <Card title="최근 개설한 반" description={`수식채점실 전체 ${formatCount(dashboard.data.metrics.classes)}개`}><RecentClasses classes={dashboard.data.recentClasses} /></Card>}
                    {view === "submissions" && <Card title="최근 제출" description={`전체 ${formatCount(dashboard.data.metrics.submissions)}건 · 반 제출 검토 전 ${formatCount(dashboard.data.metrics.pendingReviews)}건`}><RecentSubmissions submissions={dashboard.data.recentSubmissions} /></Card>}
                  </>
                ) : (
                  <section className="mg-admin-card"><QueryState loading={dashboard.loading} error={dashboard.error} onRetry={refresh} /></section>
                )}
              </>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

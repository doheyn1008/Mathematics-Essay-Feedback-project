import type {
  AdminClassSummary,
  AdminCustomer,
  AdminCustomerDetail,
  AdminCustomerList,
  AdminDashboardData,
  AdminSubmissionSummary,
  CustomerRole,
  CustomerStatus,
} from "../admin-types";
import { requireAdmin, type AdminActor } from "./admin-auth";
import { getEntitlement, productDatabase, productJson, readProductJson } from "./product-auth";
import { HttpError, optionalText } from "./validation";

const pageSize = 25;
const recentLimit = 12;
const historyLimit = 20;
const customerStatuses = new Set<string>(["new", "active", "follow_up", "closed"]);
const assignedRoles = new Set<string>(["teacher", "academy_student", "personal"]);
const customerRoles = new Set([...assignedRoles, "unassigned"]);

// Product user rows are created at signup; a profile is added at onboarding.
// Include profiles saved before the introduction of product login as well.
const accountRows = `
  WITH accounts AS (
    SELECT u.id, COALESCE(NULLIF(p.display_name, ''), NULLIF(u.name, ''), '이름 미등록') AS name,
      p.account_type AS role, u.created_at AS createdAt
    FROM product_users u
    LEFT JOIN product_profiles p ON p.user_id = u.id
    UNION ALL
    SELECT p.user_id AS id, p.display_name AS name, p.account_type AS role, p.created_at AS createdAt
    FROM product_profiles p
    WHERE NOT EXISTS (SELECT 1 FROM product_users u WHERE u.id = p.user_id)
  ),
  customers AS (
    SELECT a.id, a.name, c.username, a.role, a.createdAt,
      COALESCE(m.status, 'new') AS status, COALESCE(m.revision, 0) AS revision
    FROM accounts a
    LEFT JOIN product_credentials c ON c.user_id = a.id
    LEFT JOIN product_admin_customers m ON m.user_id = a.id
  )
`;

const customerColumns = "id, name, username, role, createdAt, status, revision";
const roleState = `
  SELECT (SELECT account_type FROM product_profiles WHERE user_id = candidate.id) AS role,
    CASE
      WHEN EXISTS (
        SELECT 1 FROM product_classes
        WHERE json_extract(data, '$.billingTeacherId') = candidate.id
      ) THEN 'billing'
      WHEN EXISTS (SELECT 1 FROM product_members WHERE user_id = candidate.id) THEN 'member'
      WHEN EXISTS (
        SELECT 1 FROM product_entitlements e
        WHERE e.user_id = candidate.id AND e.status = 'active'
          AND (COALESCE(e.expires_at, '') = '' OR julianday(e.expires_at) > julianday(candidate.checkedAt))
          AND NOT (
            (candidate.targetRole = 'teacher' AND e.plan = 'teacher')
            OR (candidate.targetRole = 'personal' AND e.plan IN ('personal_basic', 'personal_premium'))
          )
      ) THEN 'entitlement'
    END AS blocker
  FROM (SELECT ? AS id, ? AS targetRole, ? AS checkedAt) candidate
`;

const roleBlockers = {
  billing: {
    code: "CUSTOMER_ROLE_BILLING_TEACHER",
    message: "이 회원은 반의 이용권을 부담하고 있습니다. 반의 이용권 담당을 변경한 뒤 유형을 수정하세요.",
  },
  member: {
    code: "CUSTOMER_ROLE_HAS_MEMBERSHIPS",
    message: "이 회원은 소속된 반이 있습니다. 반 소속을 정리한 뒤 유형을 수정하세요.",
  },
  entitlement: {
    code: "CUSTOMER_ROLE_ACTIVE_ENTITLEMENT",
    message: "변경할 유형에서 사용할 수 없는 활성 이용권이 있습니다. 이용권 상태를 확인해 주세요.",
  },
} as const;
const submissionProjection = `
  SELECT s.id, COALESCE(NULLIF(json_extract(s.data, '$.exam.title'), ''), '제목 미등록') AS title,
    json_extract(c.data, '$.name') AS className, s.created_at AS createdAt,
    CASE WHEN json_extract(s.data, '$.reviewStatus') = 'reviewed'
      THEN 'reviewed' ELSE 'unreviewed' END AS reviewStatus,
    CASE WHEN json_extract(s.data, '$.processing') IN ('ready', 'processing', 'completed', 'failed')
      THEN json_extract(s.data, '$.processing') ELSE 'not_configured' END AS processing
  FROM product_submissions s
  LEFT JOIN product_classes c ON c.id = s.class_id
`;

function asRows<T>(result: D1Result): T[] {
  return result.results as T[];
}

async function dashboard(db: D1Database): Promise<AdminDashboardData> {
  const [metrics, customers, classes, submissions] = await db.batch([
    db.prepare(`${accountRows}
      SELECT COUNT(*) AS customers,
        COUNT(CASE WHEN status = 'new' THEN 1 END) AS newCustomers,
        COUNT(CASE WHEN status = 'follow_up' THEN 1 END) AS followUpCustomers,
        (SELECT COUNT(*) FROM product_classes) AS classes,
        (SELECT COUNT(*) FROM product_submissions) AS submissions,
        (SELECT COUNT(*) FROM product_submissions
          WHERE class_id IS NOT NULL
            AND COALESCE(json_extract(data, '$.reviewStatus'), 'unreviewed') = 'unreviewed') AS pendingReviews
      FROM customers`),
    db.prepare(`${accountRows}
      SELECT ${customerColumns} FROM customers ORDER BY createdAt DESC, id DESC LIMIT ?`).bind(recentLimit),
    db.prepare(`
      SELECT c.id, COALESCE(NULLIF(json_extract(c.data, '$.name'), ''), '반 이름 미등록') AS name,
        c.created_at AS createdAt,
        (SELECT COUNT(*) FROM product_members m WHERE m.class_id = c.id AND m.role = 'teacher') AS teachers,
        (SELECT COUNT(*) FROM product_members m WHERE m.class_id = c.id AND m.role = 'student') AS students
      FROM product_classes c
      ORDER BY c.created_at DESC, c.id DESC LIMIT ?`).bind(recentLimit),
    db.prepare(`${submissionProjection}
      ORDER BY s.created_at DESC, s.id DESC LIMIT ?`).bind(recentLimit),
  ]);

  return {
    metrics: asRows<AdminDashboardData["metrics"]>(metrics)[0],
    recentCustomers: asRows<AdminCustomer>(customers),
    recentClasses: asRows<AdminClassSummary>(classes),
    recentSubmissions: asRows<AdminSubmissionSummary>(submissions),
  };
}

type Filters = { query: string; role: CustomerRole | "unassigned" | ""; status: CustomerStatus | ""; page: number };

function readFilters(url: URL): Filters {
  const query = (url.searchParams.get("query") ?? "").trim();
  const role = url.searchParams.get("role") ?? "";
  const status = url.searchParams.get("status") ?? "";
  const page = Number(url.searchParams.get("page") ?? "1");
  if (query.length > 100) throw new HttpError(400, "검색어는 100자 이내로 입력하세요.");
  if (role && !customerRoles.has(role)) throw new HttpError(400, "회원 유형을 확인하세요.");
  if (status && !customerStatuses.has(status)) throw new HttpError(400, "관리 상태를 확인하세요.");
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000) {
    throw new HttpError(400, "페이지 번호를 확인하세요.");
  }
  return { query, role: role as Filters["role"], status: status as Filters["status"], page };
}

async function customerList(db: D1Database, { query, role, status, page }: Filters): Promise<AdminCustomerList> {
  const where = `
    WHERE (? = '' OR instr(lower(name), lower(?)) > 0 OR instr(lower(username), lower(?)) > 0)
      AND (? = '' OR COALESCE(role, 'unassigned') = ?)
      AND (? = '' OR status = ?)
  `;
  const bindings = [query, query, query, role, role, status, status];
  const [items, count] = await db.batch([
    db.prepare(`${accountRows} SELECT ${customerColumns}
      FROM customers ${where} ORDER BY createdAt DESC, id DESC LIMIT ? OFFSET ?`)
      .bind(...bindings, pageSize, (page - 1) * pageSize),
    db.prepare(`${accountRows} SELECT COUNT(*) AS total FROM customers ${where}`).bind(...bindings),
  ]);
  return { items: asRows<AdminCustomer>(items), page, pageSize, total: asRows<{ total: number }>(count)[0].total };
}

type CustomerRow = AdminCustomer & {
  note: string;
  updatedAt: string | null;
  phoneVerified: number;
  points: number;
};

async function customerDetail(db: D1Database, id: string): Promise<AdminCustomerDetail> {
  const [details, memberships, submissions, history] = await db.batch([
    db.prepare(`${accountRows}
      SELECT c.id, c.name, c.username, c.role, c.createdAt, c.status, c.revision,
        COALESCE(m.note, '') AS note, m.updated_at AS updatedAt,
        EXISTS (SELECT 1 FROM product_phone_trials t WHERE t.user_id = c.id) AS phoneVerified,
        COALESCE((SELECT SUM(amount) FROM product_points WHERE user_id = c.id), 0)
          + COALESCE((SELECT SUM(amount) FROM product_point_events WHERE user_id = c.id), 0) AS points
      FROM customers c
      LEFT JOIN product_admin_customers m ON m.user_id = c.id
      WHERE c.id = ?`).bind(id),
    db.prepare(`
      SELECT c.id, COALESCE(NULLIF(json_extract(c.data, '$.name'), ''), '반 이름 미등록') AS name,
        m.role, m.joined_at AS joinedAt
      FROM product_members m JOIN product_classes c ON c.id = m.class_id
      WHERE m.user_id = ?
      ORDER BY m.joined_at DESC, c.id DESC LIMIT ?`).bind(id, recentLimit),
    db.prepare(`${submissionProjection}
      WHERE s.student_id = ? ORDER BY s.created_at DESC, s.id DESC LIMIT ?`).bind(id, recentLimit),
    db.prepare(`
      SELECT id, status, actor_name AS actorName, created_at AS createdAt, revision,
        previous_role AS previousRole, new_role AS newRole
      FROM product_admin_customer_events WHERE user_id = ? ORDER BY revision DESC LIMIT ?`).bind(id, historyLimit),
  ]);

  const row = asRows<CustomerRow>(details)[0];
  if (!row) throw new HttpError(404, "회원을 찾을 수 없습니다.", "CUSTOMER_NOT_FOUND");
  const entitlement = await getEntitlement(db, id);
  return {
    customer: {
      ...row,
      phoneVerified: row.phoneVerified === 1,
      entitlement: entitlement && {
        plan: entitlement.plan,
        status: entitlement.status,
        expiresAt: entitlement.expiresAt,
        analysisLimit: entitlement.analysisLimit,
        used: entitlement.used,
      },
    },
    memberships: asRows<AdminCustomerDetail["memberships"][number]>(memberships),
    recentSubmissions: asRows<AdminSubmissionSummary>(submissions),
    history: asRows<AdminCustomerDetail["history"][number]>(history),
  };
}

function roleFromBody(value: unknown): CustomerRole | undefined {
  if (value === undefined) return;
  if (typeof value !== "string" || !assignedRoles.has(value)) {
    throw new HttpError(400, "회원 유형을 선택하세요.", "CUSTOMER_ROLE_INVALID");
  }
  return value as CustomerRole;
}

function readCustomerBase(db: D1Database, id: string) {
  return db.prepare(`${accountRows} SELECT revision, role FROM customers WHERE id = ?`)
    .bind(id).first<Pick<AdminCustomer, "revision" | "role">>();
}

function revisionConflict(): HttpError {
  return new HttpError(409, "다른 곳에서 회원 관리 정보가 변경되었습니다. 최신 정보를 불러와 주세요.", "CUSTOMER_REVISION_CONFLICT");
}

async function updateCustomer(
  db: D1Database,
  id: string,
  actor: AdminActor,
  body: Record<string, unknown>,
): Promise<AdminCustomerDetail> {
  const { status, revision } = body;
  if (typeof status !== "string" || !customerStatuses.has(status)) {
    throw new HttpError(400, "관리 상태를 선택하세요.");
  }
  if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER) {
    throw new HttpError(400, "수정할 기록 버전이 올바르지 않습니다.");
  }
  const requestedRole = roleFromBody(body.role);
  const note = optionalText(body.note, "내부 메모", 2000);
  const current = await readCustomerBase(db, id);
  if (!current) throw new HttpError(404, "회원을 찾을 수 없습니다.", "CUSTOMER_NOT_FOUND");
  if (current.revision !== revision) throw revisionConflict();
  const changedRole = requestedRole !== current.role ? requestedRole : undefined;
  const eventId = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  const roleGuard = changedRole
    ? `AND EXISTS (SELECT 1 FROM (${roleState}) state WHERE state.role IS ? AND state.blocker IS NULL)`
    : "";
  const roleBindings = changedRole ? [id, changedRole, createdAt, current.role] : [];

  // D1 executes this batch in one transaction. Only the winning operation ID can
  // update the product profile and create its audit event.
  const statements = [db.prepare(`
    INSERT INTO product_admin_customers (user_id, status, note, revision, updated_at, last_event_id)
    SELECT ?, ?, ?, ?, ?, ?
    WHERE (
      EXISTS (SELECT 1 FROM product_users WHERE id = ?)
      OR EXISTS (SELECT 1 FROM product_profiles WHERE user_id = ?)
    )
    AND (? = 0 OR EXISTS (
      SELECT 1 FROM product_admin_customers WHERE user_id = ? AND revision = ?
    ))
    ${roleGuard}
    ON CONFLICT (user_id) DO UPDATE SET
      status = excluded.status, note = excluded.note, revision = excluded.revision,
      updated_at = excluded.updated_at, last_event_id = excluded.last_event_id
    WHERE product_admin_customers.revision = ?
  `).bind(id, status, note, revision + 1, createdAt, eventId, id, id, revision, id, revision, ...roleBindings, revision)];

  if (changedRole) {
    statements.push(db.prepare(`
      INSERT INTO product_profiles (user_id, account_type, display_name, created_at)
      SELECT c.user_id, ?, COALESCE(NULLIF(u.name, ''), '이름 미등록'), ?
      FROM product_admin_customers c
      LEFT JOIN product_users u ON u.id = c.user_id
      WHERE c.user_id = ? AND c.last_event_id = ?
      ON CONFLICT (user_id) DO UPDATE SET account_type = excluded.account_type
    `).bind(changedRole, createdAt, id, eventId));
  }

  statements.push(db.prepare(`
    INSERT INTO product_admin_customer_events (
      id, user_id, status, revision, actor_id, actor_name, created_at, previous_role, new_role
    )
    SELECT ?, user_id, status, revision, ?, ?, updated_at, ?, ?
    FROM product_admin_customers WHERE user_id = ? AND last_event_id = ?
  `).bind(eventId, actor.id, actor.name, changedRole ? current.role : null, changedRole ?? null, id, eventId));

  const [updated] = await db.batch(statements);
  if (updated.meta.changes !== 1) {
    const latest = await readCustomerBase(db, id);
    if (!latest) throw new HttpError(404, "회원을 찾을 수 없습니다.", "CUSTOMER_NOT_FOUND");
    if (changedRole && latest.revision === revision) {
      const state = await db.prepare(roleState).bind(id, changedRole, createdAt)
        .first<{ role: CustomerRole | null; blocker: keyof typeof roleBlockers | null }>();
      if (state?.role === current.role && state.blocker) {
        const { code, message } = roleBlockers[state.blocker];
        throw new HttpError(409, message, code);
      }
    }
    throw revisionConflict();
  }
  return customerDetail(db, id);
}

function readCustomerId(segment: string): string {
  try {
    const id = decodeURIComponent(segment);
    if (!id || id.length > 200 || /[\x00-\x1f\x7f]/.test(id)) throw new Error();
    return id;
  } catch {
    throw new HttpError(400, "회원 식별자를 확인하세요.");
  }
}

export async function handleAdminApi(request: Request, path: string): Promise<Response> {
  const actor = requireAdmin(request);
  const db = productDatabase();
  if (request.method === "GET") {
    if (path === "dashboard") return productJson(await dashboard(db));
    if (path === "customers") return productJson(await customerList(db, readFilters(new URL(request.url))));
  }

  const customer = /^customers\/([^/]+)$/.exec(path);
  if (customer) {
    const id = readCustomerId(customer[1]);
    if (request.method === "GET") return productJson(await customerDetail(db, id));
    if (request.method === "POST") return productJson(await updateCustomer(db, id, actor, await readProductJson(request)));
  }
  throw new HttpError(404, "요청한 관리자 기능을 찾을 수 없습니다.");
}

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
const customerRoles = new Set<string>(["teacher", "academy_student", "personal", "unassigned"]);

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
      SELECT id, status, actor_name AS actorName, created_at AS createdAt, revision
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
  const note = optionalText(body.note, "내부 메모", 2000);
  const current = await db.prepare(`
    ${accountRows} SELECT revision FROM customers WHERE id = ?
  `).bind(id).first<{ revision: number }>();
  if (!current) throw new HttpError(404, "회원을 찾을 수 없습니다.", "CUSTOMER_NOT_FOUND");
  if (current.revision !== revision) {
    throw new HttpError(409, "다른 곳에서 회원 관리 정보가 변경되었습니다. 최신 정보를 불러와 주세요.", "CUSTOMER_REVISION_CONFLICT");
  }
  const eventId = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  // The operation ID binds the audit record to this request's specific winning update.
  // A stale update changes neither the management record nor its audit history.
  const [updated] = await db.batch([
    db.prepare(`
      INSERT INTO product_admin_customers (user_id, status, note, revision, updated_at, last_event_id)
      SELECT ?, ?, ?, ?, ?, ?
      WHERE ? = 0 OR EXISTS (
        SELECT 1 FROM product_admin_customers WHERE user_id = ? AND revision = ?
      )
      ON CONFLICT (user_id) DO UPDATE SET
        status = excluded.status, note = excluded.note, revision = excluded.revision,
        updated_at = excluded.updated_at, last_event_id = excluded.last_event_id
      WHERE product_admin_customers.revision = ?
    `).bind(id, status, note, revision + 1, createdAt, eventId, revision, id, revision, revision),
    db.prepare(`
      INSERT INTO product_admin_customer_events (id, user_id, status, revision, actor_id, actor_name, created_at)
      SELECT ?, user_id, status, revision, ?, ?, updated_at
      FROM product_admin_customers WHERE user_id = ? AND last_event_id = ?
    `).bind(eventId, actor.id, actor.name, id, eventId),
  ]);
  if (updated.meta.changes !== 1) {
    throw new HttpError(409, "다른 곳에서 회원 관리 정보가 변경되었습니다. 최신 정보를 불러와 주세요.", "CUSTOMER_REVISION_CONFLICT");
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

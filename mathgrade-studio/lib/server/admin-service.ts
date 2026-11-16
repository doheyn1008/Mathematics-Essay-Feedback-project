import type {
  AdminCustomer,
  AdminCustomerCounts,
  AdminCustomerDetail,
  AdminCustomerList,
  CustomerRole,
} from "../admin-types";
import { requireAdmin, type AdminActor } from "./admin-auth";
import { getEntitlement, productDatabase, productJson, readProductJson } from "./product-auth";
import { HttpError } from "./validation";

const pageSize = 25;
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
      COALESCE(m.revision, 0) AS revision
    FROM accounts a
    LEFT JOIN product_credentials c ON c.user_id = a.id
    LEFT JOIN product_admin_customers m ON m.user_id = a.id
  )
`;

const customerColumns = "id, name, username, role, createdAt, revision";
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

function asRows<T>(result: D1Result): T[] {
  return result.results as T[];
}

type Filters = { query: string; role: CustomerRole | "unassigned" | ""; page: number };

function readFilters(url: URL): Filters {
  const query = (url.searchParams.get("query") ?? "").trim();
  const role = url.searchParams.get("role") ?? "";
  const page = Number(url.searchParams.get("page") ?? "1");
  if (query.length > 100) throw new HttpError(400, "검색어는 100자 이내로 입력하세요.");
  if (role && !customerRoles.has(role)) throw new HttpError(400, "회원 유형을 확인하세요.");
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000) {
    throw new HttpError(400, "페이지 번호를 확인하세요.");
  }
  return { query, role: role as Filters["role"], page };
}

async function customerList(db: D1Database, { query, role, page }: Filters): Promise<AdminCustomerList> {
  const where = `
    WHERE (? = '' OR instr(lower(name), lower(?)) > 0 OR instr(lower(username), lower(?)) > 0)
      AND (? = '' OR COALESCE(role, 'unassigned') = ?)
  `;
  const bindings = [query, query, query, role, role];
  const [items, count, totals] = await db.batch([
    db.prepare(`${accountRows} SELECT ${customerColumns}
      FROM customers ${where} ORDER BY createdAt DESC, id DESC LIMIT ? OFFSET ?`)
      .bind(...bindings, pageSize, (page - 1) * pageSize),
    db.prepare(`${accountRows} SELECT COUNT(*) AS total FROM customers ${where}`).bind(...bindings),
    db.prepare(`${accountRows}
      SELECT COUNT(*) AS total,
        COUNT(CASE WHEN role = 'teacher' THEN 1 END) AS teacher,
        COUNT(CASE WHEN role = 'academy_student' THEN 1 END) AS academyStudent,
        COUNT(CASE WHEN role = 'personal' THEN 1 END) AS personal,
        COUNT(CASE WHEN role IS NULL THEN 1 END) AS unassigned
      FROM accounts`),
  ]);
  return {
    items: asRows<AdminCustomer>(items),
    page,
    pageSize,
    total: asRows<{ total: number }>(count)[0].total,
    counts: asRows<AdminCustomerCounts>(totals)[0],
  };
}

async function customerDetail(db: D1Database, id: string): Promise<AdminCustomerDetail> {
  const row = await db.prepare(`${accountRows}
    SELECT ${customerColumns},
      EXISTS (SELECT 1 FROM product_phone_trials t WHERE t.user_id = customers.id) AS phoneVerified
    FROM customers WHERE id = ?
  `).bind(id).first<AdminCustomer & { phoneVerified: number }>();
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
  };
}

function roleFromBody(value: unknown): CustomerRole {
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
  const { revision } = body;
  if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER) {
    throw new HttpError(400, "수정할 기록 버전이 올바르지 않습니다.");
  }
  const requestedRole = roleFromBody(body.role);
  const current = await readCustomerBase(db, id);
  if (!current) throw new HttpError(404, "회원을 찾을 수 없습니다.", "CUSTOMER_NOT_FOUND");
  if (current.revision !== revision) throw revisionConflict();
  if (requestedRole === current.role) return customerDetail(db, id);
  const eventId = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  // D1 runs the role change and its audit record in one transaction.
  const [updated] = await db.batch([
    db.prepare(`
      INSERT INTO product_admin_customers (user_id, status, note, revision, updated_at, last_event_id)
      SELECT ?, 'new', '', ?, ?, ?
      WHERE (
        EXISTS (SELECT 1 FROM product_users WHERE id = ?)
        OR EXISTS (SELECT 1 FROM product_profiles WHERE user_id = ?)
      )
      AND (? = 0 OR EXISTS (
        SELECT 1 FROM product_admin_customers WHERE user_id = ? AND revision = ?
      ))
      AND EXISTS (SELECT 1 FROM (${roleState}) state WHERE state.role IS ? AND state.blocker IS NULL)
      ON CONFLICT (user_id) DO UPDATE SET
        revision = excluded.revision,
        updated_at = excluded.updated_at, last_event_id = excluded.last_event_id
      WHERE product_admin_customers.revision = ?
    `).bind(id, revision + 1, createdAt, eventId, id, id, revision, id, revision, id, requestedRole, createdAt, current.role, revision),
    db.prepare(`
      INSERT INTO product_profiles (user_id, account_type, display_name, created_at)
      SELECT c.user_id, ?, COALESCE(NULLIF(u.name, ''), '이름 미등록'), ?
      FROM product_admin_customers c
      LEFT JOIN product_users u ON u.id = c.user_id
      WHERE c.user_id = ? AND c.last_event_id = ?
      ON CONFLICT (user_id) DO UPDATE SET account_type = excluded.account_type
    `).bind(requestedRole, createdAt, id, eventId),
    db.prepare(`
      INSERT INTO product_admin_customer_events (
        id, user_id, status, revision, actor_id, actor_name, created_at, previous_role, new_role
      )
      SELECT ?, user_id, status, revision, ?, ?, updated_at, ?, ?
      FROM product_admin_customers WHERE user_id = ? AND last_event_id = ?
    `).bind(eventId, actor.id, actor.name, current.role, requestedRole, id, eventId),
  ]);
  if (updated.meta.changes !== 1) {
    const latest = await readCustomerBase(db, id);
    if (!latest) throw new HttpError(404, "회원을 찾을 수 없습니다.", "CUSTOMER_NOT_FOUND");
    if (latest.revision === revision) {
      const state = await db.prepare(roleState).bind(id, requestedRole, createdAt)
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
  const actor = await requireAdmin(request);
  if (request.method === "GET" && path === "access") {
    return productJson({ allowed: true });
  }
  const db = productDatabase();
  if (request.method === "GET" && path === "customers") {
    return productJson(await customerList(db, readFilters(new URL(request.url))));
  }

  const customer = /^customers\/([^/]+)$/.exec(path);
  if (customer) {
    const id = readCustomerId(customer[1]);
    if (request.method === "GET") return productJson(await customerDetail(db, id));
    if (request.method === "POST") return productJson(await updateCustomer(db, id, actor, await readProductJson(request)));
  }
  throw new HttpError(404, "요청한 관리자 기능을 찾을 수 없습니다.");
}

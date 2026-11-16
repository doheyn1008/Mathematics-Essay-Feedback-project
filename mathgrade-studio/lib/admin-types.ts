export type CustomerStatus = "new" | "active" | "follow_up" | "closed";
export type CustomerRole = "teacher" | "academy_student" | "personal";

export type AdminCustomer = {
  id: string;
  name: string;
  username: string | null;
  role: CustomerRole | null;
  createdAt: string;
  status: CustomerStatus;
  revision: number;
};

export type AdminClassSummary = {
  id: string;
  name: string;
  teachers: number;
  students: number;
  createdAt: string;
};

export type AdminSubmissionSummary = {
  id: string;
  title: string;
  className: string | null;
  reviewStatus: "unreviewed" | "reviewed";
  processing: "not_configured" | "ready" | "processing" | "completed" | "failed";
  createdAt: string;
};

export type AdminDashboardData = {
  metrics: {
    customers: number;
    newCustomers: number;
    followUpCustomers: number;
    classes: number;
    submissions: number;
    pendingReviews: number;
  };
  recentCustomers: AdminCustomer[];
  recentClasses: AdminClassSummary[];
  recentSubmissions: AdminSubmissionSummary[];
};

export type AdminCustomerList = {
  items: AdminCustomer[];
  page: number;
  pageSize: number;
  total: number;
};

export type AdminCustomerDetail = {
  customer: AdminCustomer & {
    note: string;
    updatedAt: string | null;
    phoneVerified: boolean;
    points: number;
    entitlement: {
      plan: string;
      status: "active" | "inactive";
      expiresAt: string | null;
      analysisLimit: number | null;
      used: number;
    } | null;
  };
  memberships: { id: string; name: string; role: "teacher" | "student"; joinedAt: string }[];
  recentSubmissions: AdminSubmissionSummary[];
  history: { id: string; status: CustomerStatus; actorName: string; createdAt: string; revision: number }[];
};

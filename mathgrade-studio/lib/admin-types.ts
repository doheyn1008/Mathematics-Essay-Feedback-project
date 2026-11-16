export type CustomerRole = "teacher" | "academy_student" | "personal";

export type AdminCustomer = {
  id: string;
  name: string;
  username: string | null;
  role: CustomerRole | null;
  createdAt: string;
  revision: number;
};

export type AdminCustomerList = {
  items: AdminCustomer[];
  page: number;
  pageSize: number;
  total: number;
  counts: AdminCustomerCounts;
};

export type AdminCustomerCounts = {
  teacher: number;
  academyStudent: number;
  personal: number;
  unassigned: number;
  total: number;
};

export type AdminCustomerDetail = {
  customer: AdminCustomer & {
    phoneVerified: boolean;
    entitlement: {
      plan: string;
      status: "active" | "inactive";
      expiresAt: string | null;
      analysisLimit: number | null;
      used: number;
    } | null;
  };
};

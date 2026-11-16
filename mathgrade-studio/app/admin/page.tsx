import type { Metadata } from "next";
import { chatGPTSignInPath } from "../chatgpt-auth";
import { AdminDashboard } from "@/components/admin-dashboard";
import "./admin.css";

export const metadata: Metadata = {
  title: "관리자 센터 | 수식채점실",
  description: "수식채점실 회원, 반, 제출 관리",
  robots: { index: false, follow: false },
};

export default function AdminPage() {
  return <AdminDashboard signInUrl={chatGPTSignInPath("/admin")} />;
}

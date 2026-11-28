import type { Metadata } from "next";
import { chatGPTSignInPath } from "../chatgpt-auth";
import { AdminDashboard } from "@/components/admin-dashboard";
import { env } from "cloudflare:workers";
import "./admin.css";

export const metadata: Metadata = {
  title: "관리자 센터 | Q.E.D.",
  description: "Q.E.D. 회원 관리",
  robots: { index: false, follow: false },
};

export default function AdminPage() {
  const standalone = (env as unknown as Record<string, unknown>).DEPLOYMENT_TARGET === "cloudflare";
  return <AdminDashboard signInUrl={standalone ? "/login" : chatGPTSignInPath("/admin")} />;
}

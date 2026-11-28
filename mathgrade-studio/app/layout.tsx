import type { Metadata } from "next";
import "./globals.css";
import { SiteFooter } from "@/components/site-footer";

export const metadata: Metadata = {
  title: "Q.E.D. · 풀이를 읽고 성장을 남기다",
  description: "학생의 수학 풀이를 제출하고, 채점기준에 따라 검토·확정해 PDF 피드백을 만드는 수학 강사 작업공간",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body><div className="site-content">{children}</div><SiteFooter /></body></html>;
}

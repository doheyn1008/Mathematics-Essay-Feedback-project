import { LegalDocument } from "@/components/legal-document";
export const metadata = { title: "개인정보 처리방침 검토안 | Q.E.D.", robots: { index: false, follow: true } };
export default function PrivacyPage() { return <LegalDocument kind="privacy" />; }

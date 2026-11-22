import { LegalDocument } from "@/components/legal-document";
export const metadata = { title: "이용약관 검토안 | Q.E.D.", robots: { index: false, follow: true } };
export default function TermsPage() { return <LegalDocument kind="terms" />; }

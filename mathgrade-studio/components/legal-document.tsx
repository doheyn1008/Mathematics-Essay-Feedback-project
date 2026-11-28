import content from "@/lib/legal-content.json";
import { Download, ArrowLeft } from "lucide-react";

export function LegalDocument({ kind }: { kind: "terms" | "privacy" }) {
  const document = content[kind];
  return <main className="legal-page">
    <a className="legal-back" href="/"><ArrowLeft size={15} aria-hidden="true" /> Q.E.D. 홈으로</a>
    <header className="legal-heading">
      <p className="legal-eyebrow">Q.E.D. / SERVICE POLICY</p>
      <h1>{document.title}</h1>
      <p>{content.status} · 작성일 {content.preparedAt}</p>
      <a className="legal-download" href={`/legal/${document.filename}`} download><Download size={16} aria-hidden="true" /> 검토안 PDF 다운로드</a>
    </header>
    <aside className="legal-notice">{content.notice}</aside>
    <nav className="legal-contents" aria-label={`${document.title} 목차`}>
      {document.sections.map((section, index) => <a key={section.title} href={`#section-${index + 1}`}>{section.title}</a>)}
    </nav>
    <article className="legal-article">
      {document.sections.map((section, index) => <section id={`section-${index + 1}`} key={section.title}>
        <h2>{section.title}</h2>
        {section.paragraphs.map(paragraph => <p key={paragraph}>{paragraph}</p>)}
      </section>)}
    </article>
  </main>;
}

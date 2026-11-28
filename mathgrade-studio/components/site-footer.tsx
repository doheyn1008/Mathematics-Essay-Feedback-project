import { Mail } from "lucide-react";
import { siteInfo } from "@/lib/site-info";

export function SiteFooter() {
  return <footer className="site-footer">
    <div className="site-footer-inner">
      <div className="site-footer-about">
        <a href="/" className="site-footer-brand">{siteInfo.name}</a>
        <p>풀이의 끝에서, 다음 생각의 시작으로.</p>
        <p>개발·운영 {siteInfo.developer}</p>
      </div>
      <div className="site-footer-contact">
        <a className="site-email" href={`mailto:${siteInfo.email}`}>
          <span className="site-mail-circle"><Mail size={19} aria-hidden="true" /></span>
          <span><small>문의하기</small>{siteInfo.email}</span>
        </a>
        <nav aria-label="서비스 정책">
          <a href="/terms">이용약관 <small>검토안</small></a>
          <a href="/privacy"><strong>개인정보 처리방침</strong> <small>검토안</small></a>
        </nav>
      </div>
    </div>
    <p className="site-footer-copyright">© {siteInfo.name} · 현재 유료 상품 판매는 제공하지 않습니다.</p>
  </footer>;
}

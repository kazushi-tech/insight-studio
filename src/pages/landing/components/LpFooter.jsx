import { Link } from 'react-router-dom'
import {
  companyPrivacyUrl,
  companyProfileUrl,
  demoPreviewUrl,
  isExternalSalesUrl,
  salesContactUrl,
} from '../salesContact'

const footerLinks = [
  { label: 'プライバシーポリシー', to: companyPrivacyUrl },
  { label: '導入相談', to: salesContactUrl },
  { label: '会社概要', to: companyProfileUrl },
]

export default function LpFooter() {
  return (
    <footer className="w-full bg-surface-container-low border-t border-outline-variant">
      <div className="max-w-7xl mx-auto py-16 px-8 grid grid-cols-1 md:grid-cols-2 gap-12 items-start">
        <div>
          <Link to="/lp" className="text-2xl font-bold text-on-surface block mb-6">
            Insight Studio
          </Link>
          <p className="text-on-surface-variant text-sm max-w-sm mb-8 leading-relaxed">
            GA4とBigQueryのデータを、初心者にも読めるレポートとグラフへ。
            必要なときだけ競合・LP・クリエイティブ分析を追加できます。
          </p>
        </div>
        <div className="grid grid-cols-2 gap-8">
          <div>
            <h5 className="font-bold text-on-surface mb-4">製品</h5>
            <ul className="space-y-3 text-on-surface-variant text-sm">
              <li>
                <Link to="/lp#features" className="hover:text-primary transition-colors">
                  機能一覧
                </Link>
              </li>
              <li>
                <Link to={demoPreviewUrl} className="hover:text-primary transition-colors">
                  画面サンプル
                </Link>
              </li>
              <li>
                <Link to="/lp/pricing" className="hover:text-primary transition-colors">
                  料金プラン
                </Link>
              </li>
              <li>
                <Link to="/login" className="hover:text-primary transition-colors">
                  ご利用中の方
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <h5 className="font-bold text-on-surface mb-4">サポート</h5>
            <ul className="space-y-3 text-on-surface-variant text-sm">
              {footerLinks.map((link) => (
                <li key={link.label}>
                  {link.to ? (
                    isExternalSalesUrl(link.to) ? (
                      <a href={link.to} target="_blank" rel="noopener noreferrer" className="hover:text-primary">{link.label}</a>
                    ) : (
                      <Link to={link.to} className="hover:text-primary">{link.label}</Link>
                    )
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
      <div className="max-w-7xl mx-auto px-8 pb-12 border-t border-outline-variant pt-8 flex flex-col md:flex-row justify-between items-center gap-4">
        <p className="text-on-surface-variant/60 text-xs font-body">
          © {new Date().getFullYear()} Insight Studio. All rights reserved.
        </p>
        <div className="flex gap-6">
          <span className="text-on-surface-variant/60 text-xs">先行導入受付中</span>
        </div>
      </div>
    </footer>
  )
}

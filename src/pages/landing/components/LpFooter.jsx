import { Link } from 'react-router-dom'

const footerLinks = [
  { label: '利用規約', href: '#' },
  { label: 'プライバシーポリシー', href: '#' },
  { label: 'お問い合わせ', href: '#' },
  { label: '会社概要', href: '#' },
]

export default function LpFooter() {
  return (
    <footer className="w-full bg-stone-100 border-t border-stone-200">
      <div className="max-w-7xl mx-auto py-16 px-8 grid grid-cols-1 md:grid-cols-2 gap-12 items-start">
        <div>
          <Link to="/lp" className="text-2xl font-bold text-stone-800 block mb-6">
            Insight Studio
          </Link>
          <p className="text-stone-500 text-sm max-w-sm mb-8 leading-relaxed">
            AIの力で、マーケティングデータを価値あるインサイトへ。Insight
            Studioは、次世代の広告運用を支援する分析プラットフォームです。
          </p>
          <div className="flex gap-4">
            <span className="material-symbols-outlined text-stone-400 hover:text-[#4a7c59] cursor-pointer">
              public
            </span>
            <span className="material-symbols-outlined text-stone-400 hover:text-[#4a7c59] cursor-pointer">
              mail
            </span>
            <span className="material-symbols-outlined text-stone-400 hover:text-[#4a7c59] cursor-pointer">
              chat
            </span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-8">
          <div>
            <h5 className="font-bold text-stone-800 mb-4">製品</h5>
            <ul className="space-y-3 text-stone-500 text-sm">
              <li>
                <Link to="/lp#features" className="hover:text-[#4a7c59] transition-colors">
                  機能一覧
                </Link>
              </li>
              <li>
                <Link to="/lp#demo" className="hover:text-[#4a7c59] transition-colors">
                  分析デモ
                </Link>
              </li>
              <li>
                <Link to="/lp/pricing" className="hover:text-[#4a7c59] transition-colors">
                  料金プラン
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <h5 className="font-bold text-stone-800 mb-4">サポート</h5>
            <ul className="space-y-3 text-stone-500 text-sm">
              {footerLinks.map((link) => (
                <li key={link.label}>
                  <a
                    href={link.href}
                    className="hover:text-[#4a7c59] transition-colors"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
      <div className="max-w-7xl mx-auto px-8 pb-12 border-t border-stone-200 pt-8 flex flex-col md:flex-row justify-between items-center gap-4">
        <p className="text-stone-400 text-xs font-['Nunito_Sans']">
          © 2024 Insight Studio. All rights reserved.
        </p>
        <div className="flex gap-6">
          <span className="text-stone-400 text-xs hover:text-[#4a7c59] cursor-pointer">
            JP / English
          </span>
        </div>
      </div>
    </footer>
  )
}

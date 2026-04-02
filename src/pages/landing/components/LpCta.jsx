import { Link } from 'react-router-dom'
import LpSection from './LpSection'

export default function LpCta({
  heading = '広告運用の分析を、\n次のレベルへ。',
  body = 'データに隠れた勝ち筋を、Insight Studio で見つけましょう。まずは無料プランでその実力を体験してください。',
  primaryLabel = '無料で始める',
  primaryTo = '/',
  secondaryLabel = 'デモを予約する',
  secondaryTo = '#',
  variant = 'light',
}) {
  const isDark = variant === 'dark'

  return (
    <LpSection className={`py-24 px-6 ${isDark ? '' : 'relative overflow-hidden'}`}>
      <div
        className={`max-w-5xl mx-auto ${
          isDark
            ? 'bg-[#0f5238] rounded-3xl p-12 md:p-20 text-center relative overflow-hidden shadow-2xl'
            : 'bg-[#c8e8d0]/30 rounded-[2.5rem] p-12 md:p-20 text-center relative z-10 border border-[#4a7c59]/10'
        }`}
      >
        {isDark && (
          <div
            className="absolute inset-0 opacity-10"
            style={{
              backgroundImage:
                'radial-gradient(circle at 2px 2px, white 1px, transparent 0)',
              backgroundSize: '32px 32px',
            }}
          />
        )}
        <h2
          className={`text-3xl md:text-5xl font-extrabold mb-8 leading-tight relative z-10 whitespace-pre-line ${
            isDark ? 'text-white' : 'text-[#2e3230]'
          }`}
        >
          {heading}
        </h2>
        {body && (
          <p
            className={`text-lg mb-12 max-w-xl mx-auto relative z-10 ${
              isDark ? 'text-[#d8f0de]/80' : 'text-[#4a4e4a]'
            }`}
          >
            {body}
          </p>
        )}
        <div className="flex flex-col sm:flex-row gap-4 justify-center relative z-10">
          <Link
            to={primaryTo}
            className={`px-10 py-5 rounded-2xl font-extrabold text-xl shadow-xl hover:-translate-y-1 transition-all ${
              isDark
                ? 'bg-[#c4a66a] text-[#554020]'
                : 'bg-[#4a7c59] text-white shadow-[#4a7c59]/30'
            }`}
          >
            {primaryLabel}
          </Link>
          {secondaryLabel && (
            <Link
              to={secondaryTo}
              className={`px-10 py-5 rounded-2xl font-extrabold text-xl transition-all ${
                isDark
                  ? 'bg-transparent border-2 border-[#78a886] text-[#78a886] hover:bg-white/5'
                  : 'bg-white text-[#4a7c59] border border-[#4a7c59]/20 hover:bg-[#f5f1ea]'
              }`}
            >
              {secondaryLabel}
            </Link>
          )}
        </div>
        {!isDark && (
          <p className="mt-8 text-sm text-[#4a4e4a]/60 font-medium relative z-10">
            クレジットカード登録不要 ・ いつでもキャンセル可能
          </p>
        )}
        {isDark && (
          <p className="mt-8 text-[#d8f0de]/80 font-medium relative z-10">
            導入のご相談もお気軽に。専門スタッフがサポートいたします。
          </p>
        )}
      </div>
      {!isDark && (
        <>
          <div className="absolute -bottom-24 -left-24 w-96 h-96 bg-[#4a7c59]/5 rounded-full blur-[100px]" />
          <div className="absolute -top-24 -right-24 w-96 h-96 bg-[#705c30]/5 rounded-full blur-[100px]" />
        </>
      )}
    </LpSection>
  )
}

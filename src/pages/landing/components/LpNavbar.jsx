import { useState, useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { demoPreviewUrl } from '../salesContact'

const navLinks = [
  { label: '機能', to: '/lp#features' },
  { label: '導入まで', to: '/lp#onboarding' },
  { label: '料金', to: '/lp/pricing' },
]

export default function LpNavbar() {
  const [scrolled, setScrolled] = useState(false)
  const location = useLocation()

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header
      className={`sticky top-0 z-50 bg-white/90 backdrop-blur-lg border-b transition-shadow duration-300 ${
        scrolled
          ? 'shadow-[0_4px_20px_rgba(46,50,48,0.06)] border-outline-variant/50'
          : 'border-transparent'
      }`}
    >
      <nav className="flex justify-between items-center px-6 md:px-8 h-20 max-w-7xl mx-auto">
        <div className="flex items-center gap-12">
          <Link
            to="/lp"
            className="font-headline text-xl font-bold text-primary"
          >
            Insight Studio
          </Link>
          <div className="hidden md:flex gap-8 items-center font-body text-sm font-semibold tracking-wide">
            {navLinks.map((link) => {
              const isActive =
                location.pathname + location.hash === link.to ||
                location.pathname === link.to
              return (
                <Link
                  key={link.to}
                  to={link.to}
                  className={`transition-colors duration-200 ${
                    isActive
                      ? 'text-primary border-b-2 border-primary pb-1'
                      : 'text-on-surface-variant hover:text-primary'
                  }`}
                >
                  {link.label}
                </Link>
              )
            })}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Link
            to="/login"
            className="hidden min-h-11 items-center px-3 text-sm font-bold text-on-surface-variant transition-colors hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary sm:inline-flex"
          >
            ご利用中の方
          </Link>
          <Link
            to={demoPreviewUrl}
            className="inline-flex min-h-11 items-center rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-on-primary transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary sm:px-6"
          >
            画面サンプルを見る
          </Link>
        </div>
      </nav>
    </header>
  )
}

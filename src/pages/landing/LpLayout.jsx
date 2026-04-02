import { useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import LpNavbar from './components/LpNavbar'
import LpFooter from './components/LpFooter'
import '../../styles/landing.css'

export default function LpLayout() {
  const { hash } = useLocation()

  useEffect(() => {
    document.documentElement.dataset.theme = 'light'
    document.documentElement.style.colorScheme = 'light'
    return () => {
      const saved = localStorage.getItem('insight-studio-theme') || 'light'
      document.documentElement.dataset.theme = saved
      document.documentElement.style.colorScheme = saved
    }
  }, [])

  useEffect(() => {
    if (hash) {
      const el = document.querySelector(hash)
      if (el) el.scrollIntoView({ behavior: 'smooth' })
    } else {
      window.scrollTo(0, 0)
    }
  }, [hash])

  return (
    <div className="lp-page min-h-screen flex flex-col">
      <LpNavbar />
      <main className="flex-grow">
        <Outlet />
      </main>
      <LpFooter />
    </div>
  )
}

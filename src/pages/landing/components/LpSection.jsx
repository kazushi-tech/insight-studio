import { useEffect, useRef } from 'react'

export default function LpSection({
  children,
  className = '',
  id,
  animate = true,
}) {
  const ref = useRef(null)

  useEffect(() => {
    if (!animate) return
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.classList.add('visible')
          observer.unobserve(el)
        }
      },
      { threshold: 0.1 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [animate])

  return (
    <section
      ref={ref}
      id={id}
      className={`${animate ? 'lp-fade-in' : ''} ${className}`}
    >
      {children}
    </section>
  )
}

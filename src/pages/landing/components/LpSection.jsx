import { useEffect, useRef } from 'react'

export default function LpSection({
  children,
  className = '',
  id,
  animate = true,
  stagger = false,
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
      { threshold: 0.1, rootMargin: '0px 0px -50px 0px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [animate])

  const classes = [
    animate ? (stagger ? 'lp-stagger' : 'lp-fade-in') : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <section ref={ref} id={id} className={classes}>
      {children}
    </section>
  )
}

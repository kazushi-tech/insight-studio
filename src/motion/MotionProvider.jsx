import { LazyMotion, MotionConfig } from 'motion/react'

const loadMotionFeatures = () => import('./motion-features').then((module) => module.default)

export default function MotionProvider({ children }) {
  return (
    <MotionConfig reducedMotion="user">
      <LazyMotion features={loadMotionFeatures} strict>
        {children}
      </LazyMotion>
    </MotionConfig>
  )
}

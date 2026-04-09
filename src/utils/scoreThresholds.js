export const SCORE_THRESHOLD_EXCELLENT = 80
export const SCORE_THRESHOLD_GOOD = 60
export const SCORE_THRESHOLD_FAIR = 40

/**
 * Returns a qualitative label + color class for a 0-100 score.
 */
export function getScoreLabel(score) {
  if (score >= SCORE_THRESHOLD_EXCELLENT) return { label: 'Excellent', color: 'bg-emerald-100 text-emerald-700' }
  if (score >= SCORE_THRESHOLD_GOOD) return { label: 'Good', color: 'bg-primary/10 text-primary' }
  if (score >= SCORE_THRESHOLD_FAIR) return { label: 'Fair', color: 'bg-amber-100 text-amber-700' }
  return { label: 'Needs Work', color: 'bg-rose-100 text-rose-700' }
}

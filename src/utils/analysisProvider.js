export const ANALYSIS_PROVIDER_ANTHROPIC = 'anthropic'
export const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-6'
export const CREATIVE_REVIEW_ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001'

export function normalizeAnalysisProvider(provider) {
  const normalized = String(provider || '').trim().toLowerCase()
  if (normalized === ANALYSIS_PROVIDER_ANTHROPIC || normalized === 'claude') {
    return ANALYSIS_PROVIDER_ANTHROPIC
  }
  return null
}

export function getAnalysisModel(provider) {
  return normalizeAnalysisProvider(provider) === ANALYSIS_PROVIDER_ANTHROPIC
    ? DEFAULT_ANTHROPIC_MODEL
    : undefined
}

export function getCreativeReviewModel(provider) {
  return normalizeAnalysisProvider(provider) === ANALYSIS_PROVIDER_ANTHROPIC
    ? CREATIVE_REVIEW_ANTHROPIC_MODEL
    : undefined
}

export function getAnalysisProviderLabel(provider) {
  const normalized = normalizeAnalysisProvider(provider)
  if (normalized === ANALYSIS_PROVIDER_ANTHROPIC) return 'Claude'
  return '未設定'
}

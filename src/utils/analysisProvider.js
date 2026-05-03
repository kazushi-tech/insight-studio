export const ANALYSIS_PROVIDER_ANTHROPIC = 'anthropic'
export const ANALYSIS_PROVIDER_GEMINI = 'google'
export const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-6'
export const DEFAULT_GEMINI_MODEL = 'gemini-3.1-flash'
export const CREATIVE_REVIEW_ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001'

export function normalizeAnalysisProvider(provider) {
  const normalized = String(provider || '').trim().toLowerCase()
  if (normalized === ANALYSIS_PROVIDER_ANTHROPIC || normalized === 'claude') {
    return ANALYSIS_PROVIDER_ANTHROPIC
  }
  if (normalized === ANALYSIS_PROVIDER_GEMINI || normalized === 'gemini') {
    return ANALYSIS_PROVIDER_GEMINI
  }
  return null
}

export function getAnalysisModel(provider) {
  const normalized = normalizeAnalysisProvider(provider)
  if (normalized === ANALYSIS_PROVIDER_ANTHROPIC) return DEFAULT_ANTHROPIC_MODEL
  if (normalized === ANALYSIS_PROVIDER_GEMINI) return DEFAULT_GEMINI_MODEL
  return undefined
}

export function getCreativeReviewModel(provider) {
  return normalizeAnalysisProvider(provider) === ANALYSIS_PROVIDER_ANTHROPIC
    ? CREATIVE_REVIEW_ANTHROPIC_MODEL
    : undefined
}

export function getAnalysisProviderLabel(provider) {
  const normalized = normalizeAnalysisProvider(provider)
  if (normalized === ANALYSIS_PROVIDER_ANTHROPIC) return 'Claude'
  if (normalized === ANALYSIS_PROVIDER_GEMINI) return 'Gemini'
  return '未設定'
}

export const ANALYSIS_PROVIDER_ANTHROPIC = 'anthropic'
export const ANALYSIS_PROVIDER_GOOGLE = 'google'
export const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-6'

export function normalizeAnalysisProvider(provider) {
  const normalized = String(provider || '').trim().toLowerCase()
  if (normalized === ANALYSIS_PROVIDER_ANTHROPIC || normalized === 'claude') {
    return ANALYSIS_PROVIDER_ANTHROPIC
  }
  if (normalized === ANALYSIS_PROVIDER_GOOGLE || normalized === 'gemini') {
    return ANALYSIS_PROVIDER_GOOGLE
  }
  return null
}

export function getAnalysisModel(provider) {
  return normalizeAnalysisProvider(provider) === ANALYSIS_PROVIDER_ANTHROPIC
    ? DEFAULT_ANTHROPIC_MODEL
    : undefined
}

export function getAnalysisProviderLabel(provider) {
  const normalized = normalizeAnalysisProvider(provider)
  if (normalized === ANALYSIS_PROVIDER_ANTHROPIC) return 'Claude'
  if (normalized === ANALYSIS_PROVIDER_GOOGLE) return 'Gemini (legacy)'
  return '未設定'
}

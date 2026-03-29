import {
  ANALYSIS_PROVIDER_ANTHROPIC,
  ANALYSIS_PROVIDER_GOOGLE,
} from './analysisProvider'

export function normalizeApiKey(value) {
  return typeof value === 'string' ? value.trim() : ''
}

export function detectApiKeyProvider(value) {
  const normalized = normalizeApiKey(value)
  if (!normalized) return null
  if (normalized.startsWith('sk-ant-')) return ANALYSIS_PROVIDER_ANTHROPIC
  if (normalized.startsWith('AIza')) return ANALYSIS_PROVIDER_GOOGLE
  return 'unknown'
}

export function isCompatibleApiKey(value, provider) {
  const normalized = normalizeApiKey(value)
  if (!normalized) return false
  return detectApiKeyProvider(normalized) === provider
}

export function getApiKeyValidationError(value, provider) {
  const normalized = normalizeApiKey(value)
  if (!normalized) return null

  const detectedProvider = detectApiKeyProvider(normalized)

  if (provider === ANALYSIS_PROVIDER_ANTHROPIC) {
    if (detectedProvider === ANALYSIS_PROVIDER_GOOGLE) {
      return 'Gemini API キーです。Claude 欄ではなく Gemini 欄に保存してください。'
    }
    if (detectedProvider !== ANALYSIS_PROVIDER_ANTHROPIC) {
      return 'Claude API キーは `sk-ant-` で始まる形式を入力してください。'
    }
  }

  if (provider === ANALYSIS_PROVIDER_GOOGLE) {
    if (detectedProvider === ANALYSIS_PROVIDER_ANTHROPIC) {
      return 'Claude API キーです。Gemini 欄ではなく Claude 欄に保存してください。'
    }
    if (detectedProvider !== ANALYSIS_PROVIDER_GOOGLE) {
      return 'Gemini API キーは `AIza` で始まる形式を入力してください。'
    }
  }

  return null
}

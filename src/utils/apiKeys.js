import {
  ANALYSIS_PROVIDER_ANTHROPIC,
} from './analysisProvider'

export function normalizeApiKey(value) {
  return typeof value === 'string' ? value.trim() : ''
}

export function detectApiKeyProvider(value) {
  const normalized = normalizeApiKey(value)
  if (!normalized) return null
  if (normalized.startsWith('sk-ant-')) return ANALYSIS_PROVIDER_ANTHROPIC
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
    if (detectedProvider !== ANALYSIS_PROVIDER_ANTHROPIC) {
      return 'Claude API キーは `sk-ant-` で始まる形式を入力してください。'
    }
  }

  return null
}

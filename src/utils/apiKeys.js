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

/**
 * Validate a Claude API key by sending a minimal request to the Anthropic API.
 * Returns null on success, or an error message string on failure.
 */
export async function validateClaudeKeyRemote(apiKey) {
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    })

    if (res.ok) return null

    const body = await res.json().catch(() => ({}))
    if (res.status === 401) return 'APIキーが無効です。正しいキーを入力してください。'
    if (res.status === 403) return 'このAPIキーにはアクセス権限がありません。'
    if (res.status === 429) return null // Rate limited but key is valid
    return body?.error?.message || `APIキー検証エラー (HTTP ${res.status})`
  } catch {
    // Network error — cannot validate, allow save with warning
    return null
  }
}

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  storageKeyForCase,
  loadHistory,
  saveHistory,
  buildEntry,
  buildEntryMetadata,
  REPORT_HISTORY_MAX,
} from '../reportHistoryStorage'

function makeSetup(overrides = {}) {
  return {
    queryTypes: ['search', 'landing'],
    periods: ['2024-10', '2024-11'],
    granularity: 'monthly',
    datasetId: 'analytics_311324674',
    completedAt: '2026-04-15T05:32:00.000Z',
    ...overrides,
  }
}

function makeBundle(overrides = {}) {
  return {
    reportMd: '# タイトル\nLP 訪問から離脱するユーザーが増えています。\n',
    chartGroups: [{ title: 'CVR推移' }],
    generatedAt: '2026-04-15T05:32:30.000Z',
    source: 'bq_generate_batch',
    ...overrides,
  }
}

beforeEach(() => {
  localStorage.clear()
})

describe('storageKeyForCase', () => {
  it('returns null for falsy caseId', () => {
    expect(storageKeyForCase(null)).toBeNull()
    expect(storageKeyForCase('')).toBeNull()
    expect(storageKeyForCase(undefined)).toBeNull()
  })

  it('prefixes caseId', () => {
    expect(storageKeyForCase('petabit')).toBe('insight-studio-ads-report-history:petabit')
  })
})

describe('loadHistory', () => {
  it('returns [] when empty', () => {
    expect(loadHistory('petabit')).toEqual([])
  })

  it('returns [] when caseId is null', () => {
    expect(loadHistory(null)).toEqual([])
  })

  it('filters entries with version !== 1', () => {
    localStorage.setItem(
      'insight-studio-ads-report-history:petabit',
      JSON.stringify([
        { version: 1, id: 'a', createdAt: '2026-04-01T00:00:00Z' },
        { version: 99, id: 'b', createdAt: '2026-04-02T00:00:00Z' },
      ]),
    )
    const result = loadHistory('petabit')
    expect(result.length).toBe(1)
    expect(result[0].id).toBe('a')
  })

  it('sorts by createdAt desc', () => {
    localStorage.setItem(
      'insight-studio-ads-report-history:petabit',
      JSON.stringify([
        { version: 1, id: 'a', createdAt: '2026-04-01T00:00:00Z' },
        { version: 1, id: 'b', createdAt: '2026-04-05T00:00:00Z' },
        { version: 1, id: 'c', createdAt: '2026-04-03T00:00:00Z' },
      ]),
    )
    const result = loadHistory('petabit')
    expect(result.map((e) => e.id)).toEqual(['b', 'c', 'a'])
  })

  it('returns [] on corrupted JSON', () => {
    localStorage.setItem('insight-studio-ads-report-history:petabit', 'not-json')
    expect(loadHistory('petabit')).toEqual([])
  })
})

describe('saveHistory', () => {
  it('caps at MAX_ENTRIES', () => {
    const entries = Array.from({ length: REPORT_HISTORY_MAX + 5 }, (_, i) => ({
      version: 1,
      id: `e${i}`,
      createdAt: new Date(2026, 0, 1 + i).toISOString(),
    }))
    saveHistory('petabit', entries)
    const loaded = loadHistory('petabit')
    expect(loaded.length).toBe(REPORT_HISTORY_MAX)
  })

  it('skips when caseId is null', () => {
    const result = saveHistory(null, [{ version: 1, id: 'x', createdAt: '2026-01-01T00:00:00Z' }])
    expect(result).toBe(false)
  })

  it('falls back to dropping oldest 5 on QuotaExceededError', () => {
    const entries = Array.from({ length: 10 }, (_, i) => ({
      version: 1,
      id: `e${i}`,
      createdAt: new Date(2026, 0, 1 + i).toISOString(),
    }))

    let callCount = 0
    const originalSetItem = Storage.prototype.setItem
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
      callCount += 1
      if (callCount === 1) {
        const err = new Error('quota')
        err.name = 'QuotaExceededError'
        throw err
      }
      return originalSetItem.call(this, key, value)
    })

    const result = saveHistory('petabit', entries)
    expect(result).toBe(true)
    spy.mockRestore()
  })
})

describe('buildEntryMetadata', () => {
  it('extracts tldr from reportMd', () => {
    const meta = buildEntryMetadata(makeSetup(), makeBundle(), [])
    expect(meta.tldr).toContain('LP 訪問から離脱')
  })

  it('truncates tldr over 120 chars', () => {
    const long = 'あ'.repeat(200)
    const bundle = makeBundle({ reportMd: `# タイトル\n${long}\n` })
    const meta = buildEntryMetadata(makeSetup(), bundle, [])
    expect(meta.tldr.length).toBeLessThanOrEqual(121)
    expect(meta.tldr.endsWith('…')).toBe(true)
  })

  it('formats periods and queryTypes labels', () => {
    const meta = buildEntryMetadata(makeSetup(), makeBundle(), [])
    expect(meta.periodsLabel).toBe('2024-10, 2024-11')
    expect(meta.queryTypesLabel).toBe('検索クエリ / LP流入')
  })

  it('counts messages', () => {
    const meta = buildEntryMetadata(makeSetup(), makeBundle(), [{}, {}, {}])
    expect(meta.messageCount).toBe(3)
  })
})

describe('buildEntry', () => {
  it('creates v1 entry with required fields', () => {
    const entry = buildEntry({
      caseId: 'petabit',
      setupState: makeSetup(),
      reportBundle: makeBundle(),
      messages: [
        { role: 'user', text: 'hello' },
        { role: 'assistant', text: 'hi' },
      ],
      contextMode: 'ads-only',
    })
    expect(entry.version).toBe(1)
    expect(entry.caseId).toBe('petabit')
    expect(entry.messages.length).toBe(2)
    expect(entry.contextMode).toBe('ads-only')
    expect(entry.setupState.queryTypes).toEqual(['search', 'landing'])
    expect(entry.metadata.messageCount).toBe(2)
    expect(typeof entry.id).toBe('string')
    expect(entry.id.length).toBeGreaterThan(0)
  })

  it('normalizes legacy "ai" role to "assistant"', () => {
    const entry = buildEntry({
      caseId: 'petabit',
      setupState: makeSetup(),
      reportBundle: makeBundle(),
      messages: [{ role: 'ai', text: 'legacy' }],
      contextMode: 'ads-with-ml',
    })
    expect(entry.messages[0].role).toBe('assistant')
    expect(entry.contextMode).toBe('ads-with-ml')
  })
})

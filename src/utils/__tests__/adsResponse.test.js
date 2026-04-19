import { describe, it, expect } from 'vitest'
import { extractInsightMeta } from '../adsResponse'

describe('extractInsightMeta', () => {
  it('returns null for empty input', () => {
    expect(extractInsightMeta('')).toBeNull()
    expect(extractInsightMeta(null)).toBeNull()
    expect(extractInsightMeta(undefined)).toBeNull()
  })

  it('returns null for non-string input', () => {
    expect(extractInsightMeta(123)).toBeNull()
    expect(extractInsightMeta({})).toBeNull()
    expect(extractInsightMeta([])).toBeNull()
  })

  it('returns null when the insight-meta block is missing', () => {
    expect(extractInsightMeta('ただのマークダウン本文\n- 項目1')).toBeNull()
  })

  it('returns null for invalid JSON inside the fenced block', () => {
    const md = '本文\n\n```insight-meta\n{ this is not json }\n```'
    expect(extractInsightMeta(md)).toBeNull()
  })

  it('returns null when the JSON is not an object', () => {
    const md = '本文\n\n```insight-meta\n"some string"\n```'
    expect(extractInsightMeta(md)).toBeNull()
  })

  it('parses a valid block with tldr / key_metrics / recommended_charts', () => {
    const md = [
      '## 分析結果',
      '本文テキスト',
      '',
      '```insight-meta',
      JSON.stringify({
        tldr: ['CTRが改善', 'CPAが悪化'],
        key_metrics: [
          { label: 'CTR', value: '3.5%', delta: 'up' },
          { label: 'CPA', value: '¥2,800', delta: 'down' },
        ],
        recommended_charts: ['CVR推移', 'CPA推移'],
      }),
      '```',
    ].join('\n')

    const meta = extractInsightMeta(md)
    expect(meta).not.toBeNull()
    expect(meta.tldr).toEqual(['CTRが改善', 'CPAが悪化'])
    expect(meta.key_metrics).toEqual([
      { label: 'CTR', value: '3.5%', delta: 'up' },
      { label: 'CPA', value: '¥2,800', delta: 'down' },
    ])
    expect(meta.recommended_charts).toEqual(['CVR推移', 'CPA推移'])
  })

  it('strips the insight-meta block from _strippedMarkdown', () => {
    const md = [
      '## 分析結果',
      '本文',
      '',
      '```insight-meta',
      JSON.stringify({ tldr: ['A'] }),
      '```',
    ].join('\n')

    const meta = extractInsightMeta(md)
    expect(meta).not.toBeNull()
    expect(meta._strippedMarkdown).not.toContain('insight-meta')
    expect(meta._strippedMarkdown).toContain('## 分析結果')
    expect(meta._strippedMarkdown).toContain('本文')
  })

  it('filters out malformed tldr entries (non-strings)', () => {
    const md = [
      '```insight-meta',
      JSON.stringify({ tldr: ['OK', 123, null, { bad: true }, 'also ok'] }),
      '```',
    ].join('\n')

    const meta = extractInsightMeta(md)
    expect(meta.tldr).toEqual(['OK', 'also ok'])
  })

  it('filters out malformed key_metrics entries and invalid deltas', () => {
    const md = [
      '```insight-meta',
      JSON.stringify({
        key_metrics: [
          { label: 'CTR', value: '3.5%', delta: 'up' },
          { label: 'missing value' },
          { value: 'missing label' },
          'not an object',
          { label: 'CPA', value: '¥2,800', delta: 'sideways' },
          { label: 'CVR', value: '1.2%' },
        ],
      }),
      '```',
    ].join('\n')

    const meta = extractInsightMeta(md)
    expect(meta.key_metrics).toEqual([
      { label: 'CTR', value: '3.5%', delta: 'up' },
      { label: 'CPA', value: '¥2,800', delta: undefined },
      { label: 'CVR', value: '1.2%', delta: undefined },
    ])
  })

  it('filters out non-string recommended_charts entries', () => {
    const md = [
      '```insight-meta',
      JSON.stringify({
        recommended_charts: ['OK', 42, null, { x: 1 }, 'also ok'],
      }),
      '```',
    ].join('\n')

    const meta = extractInsightMeta(md)
    expect(meta.recommended_charts).toEqual(['OK', 'also ok'])
  })

  it('returns null when all three arrays are empty after filtering', () => {
    const md = [
      '```insight-meta',
      JSON.stringify({ tldr: [], key_metrics: [], recommended_charts: [] }),
      '```',
    ].join('\n')
    expect(extractInsightMeta(md)).toBeNull()
  })

  it('returns null when all three arrays contain only malformed entries', () => {
    const md = [
      '```insight-meta',
      JSON.stringify({
        tldr: [123, null],
        key_metrics: [{ label: 'noValue' }],
        recommended_charts: [{ x: 1 }],
      }),
      '```',
    ].join('\n')
    expect(extractInsightMeta(md)).toBeNull()
  })

  it('ignores non-array fields gracefully', () => {
    const md = [
      '```insight-meta',
      JSON.stringify({ tldr: 'not an array', key_metrics: 'also not', recommended_charts: ['OK'] }),
      '```',
    ].join('\n')
    const meta = extractInsightMeta(md)
    expect(meta).not.toBeNull()
    expect(meta.tldr).toEqual([])
    expect(meta.key_metrics).toEqual([])
    expect(meta.recommended_charts).toEqual(['OK'])
  })
})

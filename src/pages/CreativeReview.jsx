import { useState, useRef, useCallback, useEffect } from 'react'
import MarkdownRenderer from '../components/MarkdownRenderer'
import PerformanceRadar from '../components/PerformanceRadar'
import { useAuth } from '../contexts/AuthContext'
import { useAnalysisRuns } from '../contexts/AnalysisRunsContext'
import { LoadingSpinner, ErrorBanner } from '../components/ui'
import {
  uploadCreativeAsset,
  getCreativeAssetDownloadUrl,
  reviewBanner,
  reviewAdLp,
  generateBanner,
  getGeneration,
  getGenerationImageUrl,
} from '../api/marketLens'

const POLL_INTERVAL = 5000
const POLL_MAX = 12
const REVIEW_TEXT_SIZE_STORAGE_KEY = 'creative_review_text_size'
const REVIEW_TEXT_SIZE_OPTIONS = [
  { value: 'normal', label: '標準' },
  { value: 'large', label: '大' },
  { value: 'xlarge', label: '特大' },
]

const RUBRIC_LABEL_MAP = {
  visual_impact: '視覚的インパクト',
  message_clarity: 'メッセージ明瞭性',
  cta_effectiveness: 'CTA効果',
  brand_consistency: 'ブランド整合性',
  information_balance: '情報バランス',
  hook_strength: 'フック力',
  target_clarity: 'ターゲット明瞭性',
  offer_clarity: 'オファー明瞭性',
  visual_flow: '視線誘導',
  cta_clarity: 'CTA明瞭性',
  credibility: '信頼性',
  information_density: '情報密度',
  competitive_edge: '競合差別化',
  first_view_clarity: 'ファーストビュー',
  ad_to_lp_message_match: '広告-LP一致',
  benefit_clarity: 'ベネフィット',
  trust_elements: '信頼要素',
  cta_placement: 'CTA配置',
  drop_off_risk: '離脱リスク',
  input_friction: '入力摩擦',
  story_consistency: 'ストーリー一貫性',
}

// ─── Section-aware Review Blocks ───

function SectionCard({ icon, title, badge, badgeColor, borderColor, bgColor, children }) {
  return (
    <div className={`rounded-[0.75rem] border ${borderColor || 'border-outline-variant/15'} ${bgColor || 'bg-surface-container-lowest'} p-6 space-y-3`}>
      <div className="flex items-center gap-2">
        <span className="material-symbols-outlined text-lg" style={{ color: 'inherit' }}>{icon}</span>
        <h4 className="text-base font-bold japanese-text text-on-surface">{title}</h4>
        {badge && (
          <span className={`ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full ${badgeColor || 'bg-slate-100 text-slate-600'}`}>
            {badge}
          </span>
        )}
      </div>
      {children}
    </div>
  )
}

function SummarySection({ review, size }) {
  const text = review?.summary
  if (!text) return null
  return (
    <SectionCard icon="summarize" title="要約" borderColor="border-slate-200" bgColor="bg-slate-50/50">
      <MarkdownRenderer content={text} size={size} />
    </SectionCard>
  )
}

function NeutralInfoSection({ review, size }) {
  const parts = []
  if (review?.product_identification) parts.push(`### 製品特定\n${review.product_identification}`)
  if (review?.target_hypothesis) parts.push(`### ターゲット仮説\n${review.target_hypothesis}`)
  if (review?.message_angle) parts.push(`### メッセージ角度\n${review.message_angle}`)
  if (parts.length === 0) return null

  return (
    <SectionCard icon="info" title="基本情報" borderColor="border-slate-200" bgColor="bg-white">
      <MarkdownRenderer content={parts.join('\n\n')} size={size} />
    </SectionCard>
  )
}

function GoodPointsSection({ review, size }) {
  const items = [...(review?.good_points || []), ...(review?.keep_as_is || [])]
  if (items.length === 0) return null

  const md = items
    .map(({ point, reason }) => `- **${point}**\n  ${reason}`)
    .join('\n')

  return (
    <SectionCard
      icon="thumb_up"
      title="良い点・維持すべき点"
      badge={`${items.length} 件`}
      badgeColor="bg-emerald-100 text-emerald-700"
      borderColor="border-emerald-200"
      bgColor="bg-emerald-50/40"
    >
      <div className="text-emerald-900">
        <MarkdownRenderer content={md} size={size} />
      </div>
    </SectionCard>
  )
}

function ImprovementsSection({ review, size }) {
  const items = review?.improvements
  if (!Array.isArray(items) || items.length === 0) return null

  const md = items
    .map(({ point, reason, action }, i) =>
      `${i + 1}. **${point}**\n   - 背景: ${reason}\n   - 対応: ${action}`)
    .join('\n')

  return (
    <SectionCard
      icon="build"
      title="改善提案"
      badge={`${items.length} 件`}
      badgeColor="bg-amber-100 text-amber-700"
      borderColor="border-amber-200"
      bgColor="bg-amber-50/40"
    >
      <div className="text-amber-900">
        <MarkdownRenderer content={md} size={size} />
      </div>
    </SectionCard>
  )
}

function TestIdeasSection({ review, size }) {
  const items = review?.test_ideas
  if (!Array.isArray(items) || items.length === 0) return null

  const md = [
    '| 仮説 | 変更変数 | 期待効果 |',
    '| --- | --- | --- |',
    ...items.map((item) =>
      `| ${esc(item.hypothesis)} | ${esc(item.variable)} | ${esc(item.expected_impact)} |`
    ),
  ].join('\n')

  return (
    <SectionCard
      icon="science"
      title="テストアイデア"
      badge={`${items.length} 件`}
      badgeColor="bg-rose-100 text-rose-700"
      borderColor="border-rose-200"
      bgColor="bg-rose-50/30"
    >
      <MarkdownRenderer content={md} size={size} />
    </SectionCard>
  )
}

function EvidenceSection({ review, size }) {
  const items = review?.evidence
  if (!Array.isArray(items) || items.length === 0) return null

  const md = [
    '| 種別 | 出典 | 観察内容 |',
    '| --- | --- | --- |',
    ...items.map((item) =>
      `| ${esc(item.evidence_type)} | ${esc(item.evidence_source)} | ${esc(item.evidence_text)} |`
    ),
  ].join('\n')

  return (
    <SectionCard icon="fact_check" title="エビデンス" borderColor="border-slate-200" bgColor="bg-white">
      <MarkdownRenderer content={md} size={size} />
    </SectionCard>
  )
}

function RubricSection({ review }) {
  const items = review?.rubric_scores
  if (!Array.isArray(items) || items.length === 0) return null

  const avgScore = items.length > 0
    ? (items.reduce((sum, item) => sum + (item.score || 0), 0) / items.length).toFixed(1)
    : null

  return (
    <SectionCard
      icon="analytics"
      title="ルーブリック評価"
      badge={avgScore ? `平均 ${avgScore} / 5` : null}
      badgeColor="bg-secondary/10 text-secondary"
      borderColor="border-secondary/20"
      bgColor="bg-surface-container-lowest"
    >
      <div className="grid grid-cols-2 gap-3">
        {items.map((item) => {
          const label = RUBRIC_LABEL_MAP[item.rubric_id] || item.rubric_id
          const score = item.score || 0
          const pct = (score / 5) * 100
          const barColor = score >= 4 ? 'bg-emerald-500' : score >= 3 ? 'bg-amber-400' : 'bg-rose-400'
          return (
            <div key={item.rubric_id} className="bg-surface-container/40 rounded-[0.75rem] px-4 py-3">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-bold text-on-surface japanese-text">{label}</span>
                <span className="text-sm font-black tabular-nums text-on-surface">{score}<span className="text-on-surface-variant font-normal text-xs">/5</span></span>
              </div>
              <div className="h-1.5 bg-surface-container rounded-full overflow-hidden">
                <div className={`h-full ${barColor} rounded-full transition-all`} style={{ width: `${pct}%` }} />
              </div>
              {item.comment && <p className="text-xs text-on-surface-variant mt-1.5 leading-relaxed">{item.comment}</p>}
            </div>
          )
        })}
      </div>
    </SectionCard>
  )
}

function PositioningSection({ review, size }) {
  const items = review?.positioning_insights
  if (!Array.isArray(items) || items.length === 0) return null

  const md = [
    '| 観点 | 自社 | 競合 | 示唆 |',
    '| --- | --- | --- | --- |',
    ...items.map((item) =>
      `| ${esc(item.dimension)} | ${esc(item.our_position)} | ${esc(item.competitor_position)} | ${esc(item.gap_analysis)} / ${esc(item.recommendation)} |`
    ),
  ].join('\n')

  return (
    <SectionCard icon="compare_arrows" title="ポジショニング分析" borderColor="border-slate-200" bgColor="bg-white">
      <MarkdownRenderer content={md} size={size} />
    </SectionCard>
  )
}

function esc(value) {
  if (value == null) return '-'
  return String(value).trim().replace(/\|/g, '\\|').replace(/\r?\n+/g, ' ') || '-'
}

function ReviewResultDisplay({ review, size }) {
  if (!review) return null

  // If string (raw markdown), fall back to MarkdownRenderer
  if (typeof review === 'string') {
    return <MarkdownRenderer content={review} size={size} />
  }

  // If structured review with no recognized fields, fall back to markdown or JSON
  const hasStructured = review.summary || review.product_identification || review.target_hypothesis ||
    review.message_angle || review.good_points || review.keep_as_is || review.improvements ||
    review.rubric_scores || review.test_ideas || review.evidence || review.positioning_insights

  if (!hasStructured && review.markdown) {
    return <MarkdownRenderer content={review.markdown} size={size} />
  }

  if (!hasStructured) {
    return (
      <pre className="whitespace-pre-wrap text-xs leading-relaxed text-on-surface-variant">
        {JSON.stringify(review, null, 2)}
      </pre>
    )
  }

  return (
    <div className="space-y-5">
      <SummarySection review={review} size={size} />
      <NeutralInfoSection review={review} size={size} />
      <GoodPointsSection review={review} size={size} />
      <ImprovementsSection review={review} size={size} />
      <TestIdeasSection review={review} size={size} />
      <EvidenceSection review={review} size={size} />
      <RubricSection review={review} />
      <PositioningSection review={review} size={size} />
    </div>
  )
}

// ─── Meta Band ───

function formatElapsed(ms) {
  if (!ms) return null
  const sec = Math.round(ms / 1000)
  return sec < 60 ? `${sec}秒` : `${Math.floor(sec / 60)}分${sec % 60}秒`
}

function MetaBand({ run }) {
  if (!run || run.status === 'idle') return null
  const elapsed = run.startedAt && run.finishedAt ? run.finishedAt - run.startedAt : null

  return (
    <div className="flex items-center gap-3 text-xs text-on-surface-variant">
      <span className="flex items-center gap-1.5 px-3 py-1 bg-surface-container rounded-full font-bold">
        <span className={`w-1.5 h-1.5 rounded-full ${
          run.status === 'running' ? 'bg-amber-400 animate-pulse' :
          run.status === 'completed' ? 'bg-emerald-500' :
          'bg-red-400'
        }`} />
        {run.status === 'running' ? 'レビュー中…' : run.status === 'completed' ? 'レビュー完了' : 'エラー'}
      </span>
      {run.meta?.run_id && <span className="text-outline font-mono">run: {run.meta.run_id}</span>}
      {elapsed && <span>{formatElapsed(elapsed)}</span>}
    </div>
  )
}

function BannerComparisonCard({ label, title, tone = 'neutral', src, alt, meta = [], fallbackText }) {
  const toneClasses = tone === 'after'
    ? 'border-emerald-200 bg-emerald-50/50'
    : 'border-slate-200 bg-slate-50/70'

  return (
    <div className={`rounded-[0.75rem] border ${toneClasses} p-4 md:p-5 space-y-4`}>
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.16em] ${
            tone === 'after'
              ? 'bg-emerald-100 text-emerald-700'
              : 'bg-slate-200 text-slate-700'
          }`}>
            {label}
          </span>
          <h4 className="text-base font-bold text-on-surface japanese-text">{title}</h4>
        </div>
        {meta.length > 0 && (
          <p className="text-xs text-on-surface-variant">
            {meta.filter(Boolean).join(' / ')}
          </p>
        )}
      </div>

      <div className="rounded-xl border border-outline-variant/20 bg-white p-3 panel-card-hover min-h-[280px] flex items-center justify-center">
        {src ? (
          <img
            src={src}
            alt={alt}
            className="max-w-full max-h-[540px] h-auto rounded-xl object-contain"
          />
        ) : (
          <div className="text-center px-6 py-10 text-on-surface-variant">
            <span className="material-symbols-outlined text-4xl mb-2 block text-outline-variant">image_not_supported</span>
            <p className="text-sm japanese-text">{fallbackText}</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Main Component ───

export default function CreativeReview() {
  const { geminiKey: apiKey, setGeminiKey } = useAuth()
  const { getRun, startRun, completeRun, failRun, clearRun } = useAnalysisRuns()

  const reviewRun = getRun('creative-review')
  const genRun = getRun('banner-generation')

  // ─── local state (upload form — not long-running, doesn't need run store) ───
  const [phase, setPhase] = useState(() => {
    if (genRun?.status === 'completed') return 'generated'
    if (genRun?.status === 'running') return 'generating'
    if (reviewRun?.status === 'completed') return 'reviewed'
    if (reviewRun?.status === 'running') return 'reviewing'
    if (reviewRun?.input?.assetId) return 'uploaded'
    return 'idle'
  })

  const [errorMessage, setErrorMessage] = useState('')
  const [previewUrl, setPreviewUrl] = useState(() => reviewRun?.input?.previewUrl || null)
  const [fileName, setFileName] = useState(() => reviewRun?.input?.fileName || '')
  const [assetId, setAssetId] = useState(() => reviewRun?.input?.assetId || null)
  const [assetMeta, setAssetMeta] = useState(() => reviewRun?.input?.assetMeta || null)

  const [brandInfo, setBrandInfo] = useState(() => reviewRun?.input?.brandInfo || '')
  const [operatorMemo, setOperatorMemo] = useState(() => reviewRun?.input?.operatorMemo || '')
  const [lpUrl, setLpUrl] = useState(() => reviewRun?.input?.lpUrl || '')

  const reviewResult = reviewRun?.result?.review || reviewRun?.result || null
  const runId = reviewRun?.meta?.run_id || null
  const genImageUrl = genRun?.result?.imageUrl || null
  const genId = genRun?.result?.genId || null
  const originalBannerUrl = previewUrl || (assetId ? getCreativeAssetDownloadUrl(assetId) : null)

  const [reviewTextSize, setReviewTextSize] = useState(
    () => localStorage.getItem(REVIEW_TEXT_SIZE_STORAGE_KEY) || 'large',
  )

  const fileInputRef = useRef(null)
  const dropZoneRef = useRef(null)

  // Sync phase from run store on mount
  useEffect(() => {
    if (reviewRun?.status === 'failed') {
      setPhase('error')
      setErrorMessage(reviewRun.error)
    }
    if (genRun?.status === 'failed') {
      setPhase('error')
      setErrorMessage(genRun.error)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── helpers ───
  const resetAll = useCallback(() => {
    setPhase('idle')
    setErrorMessage('')
    setPreviewUrl(null)
    setFileName('')
    setAssetId(null)
    setAssetMeta(null)
    setBrandInfo('')
    setOperatorMemo('')
    setLpUrl('')
    clearRun('creative-review')
    clearRun('banner-generation')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [clearRun])

  const goError = useCallback((msg) => {
    setPhase('error')
    setErrorMessage(msg)
  }, [])

  const handleReviewTextSizeChange = useCallback((size) => {
    setReviewTextSize(size)
    localStorage.setItem(REVIEW_TEXT_SIZE_STORAGE_KEY, size)
  }, [])

  // ─── 1. Upload ───
  const handleFile = useCallback(async (file) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      goError('画像ファイル（PNG/JPG）を選択してください。')
      return
    }

    const reader = new FileReader()
    reader.onload = (e) => setPreviewUrl(e.target.result)
    reader.readAsDataURL(file)
    setFileName(file.name)

    setPhase('uploading')
    setErrorMessage('')
    try {
      const data = await uploadCreativeAsset(file)
      setAssetId(data.asset_id)
      setAssetMeta(data)
      setPhase('uploaded')
    } catch (err) {
      goError(`アップロード失敗: ${err.message}`)
    }
  }, [goError])

  const onFileChange = useCallback((e) => {
    handleFile(e.target.files[0])
  }, [handleFile])

  const onDrop = useCallback((e) => {
    e.preventDefault()
    dropZoneRef.current?.classList.remove('ring-2', 'ring-secondary')
    if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0])
  }, [handleFile])

  const onDragOver = useCallback((e) => {
    e.preventDefault()
    dropZoneRef.current?.classList.add('ring-2', 'ring-secondary')
  }, [])

  const onDragLeave = useCallback(() => {
    dropZoneRef.current?.classList.remove('ring-2', 'ring-secondary')
  }, [])

  // ─── 2. Review ───
  const handleReview = useCallback(async () => {
    if (!assetId || !apiKey.trim()) return

    setPhase('reviewing')
    setErrorMessage('')
    clearRun('banner-generation')

    startRun('creative-review', {
      assetId, brandInfo, operatorMemo, lpUrl,
      previewUrl, fileName, assetMeta,
    })

    try {
      const payload = {
        asset_id: assetId,
        brand_info: brandInfo,
        operator_memo: operatorMemo,
      }

      let envelope
      if (lpUrl.trim()) {
        payload.landing_page = { url: lpUrl.trim() }
        envelope = await reviewAdLp(payload, apiKey.trim())
      } else {
        envelope = await reviewBanner(payload, apiKey.trim())
      }

      const review = envelope.review || envelope
      completeRun('creative-review', { review, envelope }, { run_id: envelope.run_id })
      setPhase('reviewed')
    } catch (err) {
      failRun('creative-review', err.message)
      goError(`レビュー失敗: ${err.message}`)
    }
  }, [assetId, apiKey, brandInfo, operatorMemo, lpUrl, previewUrl, fileName, assetMeta, startRun, completeRun, failRun, clearRun, goError])

  // ─── 3. Generation ───
  const handleGenerate = useCallback(async () => {
    if (!runId || !apiKey.trim()) return

    setPhase('generating')
    setErrorMessage('')

    startRun('banner-generation', { runId })

    try {
      const result = await generateBanner({ review_run_id: runId }, apiKey.trim())
      const gId = result.id

      let status = result.status
      for (let i = 0; i < POLL_MAX && (status === 'pending' || status === 'generating'); i++) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL))
        const pollData = await getGeneration(gId)
        status = pollData.status
        if (pollData.error_message) throw new Error(pollData.error_message)
      }

      if (status === 'completed') {
        const imageUrl = getGenerationImageUrl(gId)
        completeRun('banner-generation', { imageUrl, genId: gId })
        setPhase('generated')
      } else if (status === 'failed') {
        throw new Error('バナー生成に失敗しました。')
      } else {
        throw new Error('生成がタイムアウトしました。しばらく後にお試しください。')
      }
    } catch (err) {
      failRun('banner-generation', err.message)
      goError(`生成失敗: ${err.message}`)
    }
  }, [runId, apiKey, startRun, completeRun, failRun, goError])

  // ─── render helpers ───
  const isUploaded = ['uploaded', 'reviewing', 'reviewed', 'generating', 'generated'].includes(phase)
  const isReviewed = ['reviewed', 'generating', 'generated'].includes(phase)

  return (
    <div className="p-10 max-w-[1400px] mx-auto space-y-8">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <div className="flex items-center gap-2 text-sm text-on-surface-variant mb-2">
            <span>競合LP分析</span>
            <span className="material-symbols-outlined text-sm">chevron_right</span>
            <span className="text-secondary font-bold">クリエイティブ・レビュー</span>
          </div>
          <h2 className="text-3xl font-bold text-on-surface tracking-tight">Creative Review & Banner Generation</h2>
          <p className="text-on-surface-variant text-sm mt-1">バナー画像をアップロード → AIレビュー → 改善バナー自動生成</p>
        </div>
      </div>

      {/* Error Banner */}
      {phase === 'error' && (
        <ErrorBanner
          message={errorMessage}
          onRetry={() => {
            if (assetId) setPhase('uploaded')
            else { resetAll() }
          }}
        />
      )}

      {/* Meta Band */}
      {reviewRun && <MetaBand run={reviewRun} />}

      {/* ─── API Key ─── */}
      <div className="bg-surface-container-lowest rounded-[0.75rem] panel-card-hover p-6">
        <label className="flex items-center gap-2 text-sm font-bold text-on-surface japanese-text mb-3">
          <span className="material-symbols-outlined text-secondary text-lg">key</span>
          Gemini API キー（BYOK）
        </label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setGeminiKey(e.target.value)}
          placeholder="Gemini API キーを入力"
          className="w-full px-4 py-2.5 rounded-[0.75rem] border border-outline-variant bg-surface-container text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary"
        />
        <p className="text-xs text-on-surface-variant mt-2">レビューとバナー生成に同じAPIキーが使用されます。ブラウザに保存されます。</p>
      </div>

      {/* ─── Step 1: Upload ─── */}
      <div className="bg-surface-container-lowest rounded-[0.75rem] panel-card-hover p-6">
        <h3 className="text-lg font-bold text-on-surface japanese-text mb-4 flex items-center gap-2">
          <span className="w-7 h-7 bg-secondary/10 rounded-lg flex items-center justify-center text-secondary text-sm font-extrabold">1</span>
          バナー画像アップロード
        </h3>

        {(!isUploaded && phase !== 'uploading') && (
          <div
            ref={dropZoneRef}
            onClick={() => fileInputRef.current?.click()}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            className="border-2 border-dashed border-outline-variant rounded-[0.75rem] p-10 flex flex-col items-center justify-center cursor-pointer hover:border-secondary hover:bg-secondary/5 transition-all"
          >
            <span className="material-symbols-outlined text-4xl text-on-surface-variant mb-3">cloud_upload</span>
            <p className="text-sm text-on-surface-variant japanese-text">クリックまたはドラッグ＆ドロップで画像を選択</p>
            <p className="text-xs text-on-surface-variant/60 mt-1">PNG / JPG 対応</p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={onFileChange}
              className="hidden"
            />
          </div>
        )}

        {phase === 'uploading' && (
          <div className="flex flex-col items-center py-8 gap-3">
            {previewUrl && <img src={previewUrl} alt="プレビュー" className="w-48 h-auto rounded-xl opacity-60" />}
            <LoadingSpinner label="アップロード中…" />
          </div>
        )}

        {isUploaded && (
          <div className="flex gap-6 items-start">
            {previewUrl && (
              <img src={previewUrl} alt="アップロード済み画像" className="w-56 h-auto rounded-xl border border-outline-variant shadow-sm" />
            )}
            <div className="flex-1 space-y-2">
              <p className="text-sm font-bold text-on-surface flex items-center gap-2">
                <span className="material-symbols-outlined text-green-600 text-lg">check_circle</span>
                {fileName}
              </p>
              {assetMeta && (
                <div className="text-xs text-on-surface-variant space-y-0.5">
                  {assetMeta.width && assetMeta.height && <p>{assetMeta.width} × {assetMeta.height}px</p>}
                  {assetMeta.mime_type && <p>{assetMeta.mime_type}</p>}
                  {assetMeta.size_bytes && <p>{(assetMeta.size_bytes / 1024).toFixed(1)} KB</p>}
                </div>
              )}
              <p className="text-xs text-on-surface-variant/50 font-mono">asset_id: {assetId}</p>
              <button
                onClick={resetAll}
                className="mt-2 px-4 py-1.5 text-xs bg-surface-container hover:bg-surface-container-high rounded-lg transition-colors text-on-surface-variant font-bold"
              >
                別の画像をアップロード
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ─── Step 2: Review Input ─── */}
      {isUploaded && (
        <div className="bg-surface-container-lowest rounded-[0.75rem] panel-card-hover p-6 space-y-4">
          <h3 className="text-lg font-bold text-on-surface japanese-text mb-2 flex items-center gap-2">
            <span className="w-7 h-7 bg-secondary/10 rounded-lg flex items-center justify-center text-secondary text-sm font-extrabold">2</span>
            レビュー設定
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-on-surface-variant mb-1">ブランド情報（任意）</label>
              <input
                type="text"
                value={brandInfo}
                onChange={(e) => setBrandInfo(e.target.value)}
                placeholder="例: 化粧品ブランドA、ターゲット20代女性"
                className="w-full px-4 py-2.5 rounded-[0.75rem] border border-outline-variant bg-surface-container text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-on-surface-variant mb-1">LP URL（任意 — 入力するとLP統合レビュー）</label>
              <input
                type="url"
                value={lpUrl}
                onChange={(e) => setLpUrl(e.target.value)}
                placeholder="https://example.com/lp"
                className="w-full px-4 py-2.5 rounded-[0.75rem] border border-outline-variant bg-surface-container text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-on-surface-variant mb-1">運用メモ（任意）</label>
            <textarea
              value={operatorMemo}
              onChange={(e) => setOperatorMemo(e.target.value)}
              placeholder="レビューで注目してほしいポイントなど"
              rows={2}
              className="w-full px-4 py-2.5 rounded-[0.75rem] border border-outline-variant bg-surface-container text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary resize-none"
            />
          </div>

          <button
            onClick={handleReview}
            disabled={!apiKey.trim() || phase === 'reviewing'}
            className="px-6 py-3 bg-primary text-on-primary rounded-[0.75rem] font-bold flex items-center gap-2 hover:opacity-90 transition-all text-sm disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {phase === 'reviewing' ? (
              <LoadingSpinner size="sm" label="レビュー中…" />
            ) : (
              <>
                <span className="material-symbols-outlined text-lg">rate_review</span>
                {lpUrl.trim() ? '広告+LP統合レビューを実行' : 'バナーレビューを実行'}
              </>
            )}
          </button>

          {!apiKey.trim() && (
            <p className="text-xs text-amber-600">Gemini API キーを入力してください。</p>
          )}
        </div>
      )}

      {/* ─── Step 3: Review Result (section-aware blocks) ─── */}
      {isReviewed && reviewResult && (
        <div className="bg-surface-container-lowest rounded-[0.75rem] panel-card-hover p-6 space-y-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <h3 className="text-lg font-bold text-on-surface japanese-text flex items-center gap-2">
              <span className="w-7 h-7 bg-secondary/10 rounded-lg flex items-center justify-center text-secondary text-sm font-extrabold">3</span>
              レビュー結果
            </h3>
            <div className="flex items-center gap-2 self-start md:self-auto">
              <span className="text-xs font-bold text-on-surface-variant japanese-text">文字サイズ</span>
              <div className="inline-flex rounded-full bg-surface-container p-1">
                {REVIEW_TEXT_SIZE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => handleReviewTextSizeChange(option.value)}
                    className={`px-3 py-1.5 rounded-full text-xs font-bold transition-colors ${
                      reviewTextSize === option.value
                        ? 'bg-primary text-on-primary'
                        : 'text-on-surface-variant hover:bg-surface-container-high'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Performance Radar — stitch2 diamond visualization */}
          {reviewResult?.rubric_scores && <PerformanceRadar rubricScores={reviewResult.rubric_scores} />}

          {/* Section-aware review blocks — no more giant scroll box */}
          <ReviewResultDisplay review={reviewResult} size={reviewTextSize} />

          {runId && (
            <p className="text-xs text-on-surface-variant/50 font-mono">run_id: {runId}</p>
          )}

          {/* Generation button */}
          {runId && (
            <button
              onClick={handleGenerate}
              disabled={!apiKey.trim() || phase === 'generating'}
              className="px-6 py-3 bg-secondary text-on-secondary rounded-[0.75rem] font-bold flex items-center gap-2 hover:opacity-90 transition-all text-sm disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {phase === 'generating' ? (
                <LoadingSpinner size="sm" label="改善バナーを生成中…" />
              ) : (
                <>
                  <span className="material-symbols-outlined text-lg">auto_fix_high</span>
                  改善バナーを生成（Nano Banana2）
                </>
              )}
            </button>
          )}
        </div>
      )}

      {/* ─── Step 4: Generated Banner ─── */}
      {phase === 'generated' && genImageUrl && (
        <div className="bg-surface-container-lowest rounded-[0.75rem] panel-card-hover p-6 space-y-4">
          <h3 className="text-lg font-bold text-on-surface japanese-text mb-2 flex items-center gap-2">
            <span className="w-7 h-7 bg-green-100 rounded-lg flex items-center justify-center text-green-700 text-sm font-extrabold">4</span>
            改善バナー
          </h3>

          <p className="text-sm text-on-surface-variant japanese-text">
            左が改善前、右が改善後です。並べて比較しながら差分を確認できます。
          </p>

          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_72px_minmax(0,1fr)] gap-5 items-stretch">
            <BannerComparisonCard
              label="Before"
              title="改善前のバナー"
              tone="before"
              src={originalBannerUrl}
              alt="改善前のバナー"
              meta={[
                fileName,
                assetMeta?.width && assetMeta?.height ? `${assetMeta.width} × ${assetMeta.height}px` : null,
              ]}
              fallbackText="元バナー画像を表示できませんでした。"
            />

            <div className="hidden xl:flex items-center justify-center">
              <div className="w-14 h-14 rounded-full bg-secondary/10 text-secondary flex items-center justify-center">
                <span className="material-symbols-outlined text-3xl">arrow_forward_alt</span>
              </div>
            </div>

            <BannerComparisonCard
              label="After"
              title="改善後のバナー"
              tone="after"
              src={genImageUrl}
              alt="生成されたバナー"
              meta={[
                'Nano Banana2',
                genId ? `generation ${genId}` : null,
              ]}
              fallbackText="改善後バナーを表示できませんでした。"
            />
          </div>

          <div className="flex flex-wrap gap-3 justify-center xl:justify-end">
            {originalBannerUrl && (
              <a
                href={originalBannerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="px-5 py-2.5 bg-surface-container text-on-surface rounded-[0.75rem] font-bold flex items-center gap-2 hover:bg-surface-container-high transition-all text-sm"
              >
                <span className="material-symbols-outlined text-lg">left_panel_open</span>
                元画像を開く
              </a>
            )}
            <div className="flex flex-wrap gap-3">
              <a
                href={genImageUrl}
                download={`banner-${genId}.png`}
                className="px-5 py-2.5 bg-primary text-on-primary rounded-[0.75rem] font-bold flex items-center gap-2 hover:opacity-90 transition-all text-sm"
              >
                <span className="material-symbols-outlined text-lg">download</span>
                ダウンロード
              </a>
              <button
                onClick={resetAll}
                className="px-5 py-2.5 bg-surface-container text-on-surface rounded-[0.75rem] font-bold flex items-center gap-2 hover:bg-surface-container-high transition-all text-sm"
              >
                <span className="material-symbols-outlined text-lg">restart_alt</span>
                新しいレビューを開始
              </button>
            </div>
          </div>

          {genId && (
            <p className="text-xs text-on-surface-variant/50 font-mono text-center">generation_id: {genId}</p>
          )}
        </div>
      )}

      {/* ─── Flow Guide (idle only) ─── */}
      {phase === 'idle' && (
        <div className="bg-surface-container-lowest rounded-xl panel-card-hover p-8">
          <h3 className="text-lg font-bold text-on-surface japanese-text mb-6 flex items-center gap-2">
            <span className="material-symbols-outlined text-secondary">info</span>
            使い方
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {[
              { icon: 'cloud_upload', title: '画像をアップロード', desc: 'バナー画像（PNG/JPG）を選択' },
              { icon: 'rate_review', title: 'AIレビュー', desc: 'Geminiがバナーを分析・評価' },
              { icon: 'auto_fix_high', title: 'バナー生成', desc: 'Nano Banana2で改善版を自動生成' },
              { icon: 'download', title: 'ダウンロード', desc: '生成されたバナーを保存' },
            ].map((step, i) => (
              <div key={i} className="flex flex-col items-center text-center p-4">
                <div className="w-12 h-12 bg-secondary/10 rounded-[0.75rem] flex items-center justify-center mb-3">
                  <span className="material-symbols-outlined text-2xl text-secondary">{step.icon}</span>
                </div>
                <p className="text-sm font-bold text-on-surface japanese-text">{step.title}</p>
                <p className="text-xs text-on-surface-variant mt-1">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

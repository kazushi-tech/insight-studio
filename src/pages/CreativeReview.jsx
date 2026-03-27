import { useState, useRef, useCallback } from 'react'
import { LoadingSpinner, ErrorBanner } from '../components/ui'
import {
  uploadCreativeAsset,
  reviewBanner,
  reviewAdLp,
  generateBanner,
  getGeneration,
  getGenerationImageUrl,
} from '../api/marketLens'

const POLL_INTERVAL = 5000
const POLL_MAX = 12

export default function CreativeReview() {
  // ─── state machine ───
  const [phase, setPhase] = useState('idle')
  // idle → uploading → uploaded → reviewing → reviewed → generating → generated
  // any → error (with errorMessage)

  const [errorMessage, setErrorMessage] = useState('')
  const [previewUrl, setPreviewUrl] = useState(null)
  const [fileName, setFileName] = useState('')
  const [assetId, setAssetId] = useState(null)
  const [assetMeta, setAssetMeta] = useState(null)

  // review
  const [brandInfo, setBrandInfo] = useState('')
  const [operatorMemo, setOperatorMemo] = useState('')
  const [lpUrl, setLpUrl] = useState('')
  const [reviewResult, setReviewResult] = useState(null)
  const [runId, setRunId] = useState(null)

  // generation
  const [genImageUrl, setGenImageUrl] = useState(null)
  const [genId, setGenId] = useState(null)

  // BYOK
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('gemini_api_key') || '')

  const fileInputRef = useRef(null)
  const dropZoneRef = useRef(null)

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
    setReviewResult(null)
    setRunId(null)
    setGenImageUrl(null)
    setGenId(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [])

  const goError = useCallback((msg) => {
    setPhase('error')
    setErrorMessage(msg)
  }, [])

  // ─── 1. Upload ───
  const handleFile = useCallback(async (file) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      goError('画像ファイル（PNG/JPG）を選択してください。')
      return
    }

    // local preview
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

    localStorage.setItem('gemini_api_key', apiKey.trim())
    setPhase('reviewing')
    setErrorMessage('')
    setReviewResult(null)
    setRunId(null)
    setGenImageUrl(null)
    setGenId(null)

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
      setReviewResult(review)
      if (envelope.run_id) setRunId(envelope.run_id)
      setPhase('reviewed')
    } catch (err) {
      goError(`レビュー失敗: ${err.message}`)
    }
  }, [assetId, apiKey, brandInfo, operatorMemo, lpUrl, goError])

  // ─── 3. Generation ───
  const handleGenerate = useCallback(async () => {
    if (!runId || !apiKey.trim()) return

    setPhase('generating')
    setErrorMessage('')
    setGenImageUrl(null)

    try {
      const result = await generateBanner({ review_run_id: runId }, apiKey.trim())
      const gId = result.id
      setGenId(gId)

      // poll
      let status = result.status
      for (let i = 0; i < POLL_MAX && (status === 'pending' || status === 'generating'); i++) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL))
        const pollData = await getGeneration(gId)
        status = pollData.status
        if (pollData.error_message) throw new Error(pollData.error_message)
      }

      if (status === 'completed') {
        setGenImageUrl(getGenerationImageUrl(gId))
        setPhase('generated')
      } else if (status === 'failed') {
        throw new Error('バナー生成に失敗しました。')
      } else {
        throw new Error('生成がタイムアウトしました。しばらく後にお試しください。')
      }
    } catch (err) {
      goError(`生成失敗: ${err.message}`)
    }
  }, [runId, apiKey, goError])

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
          <h2 className="text-4xl font-extrabold text-[#1A1A2E] tracking-tight">Creative Review & Banner Generation</h2>
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

      {/* ─── API Key ─── */}
      <div className="bg-surface-container-lowest rounded-2xl shadow-[0_24px_48px_-12px_rgba(26,26,46,0.08)] p-6">
        <label className="flex items-center gap-2 text-sm font-bold text-on-surface japanese-text mb-3">
          <span className="material-symbols-outlined text-secondary text-lg">key</span>
          Gemini API キー（BYOK）
        </label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="Gemini API キーを入力"
          className="w-full px-4 py-2.5 rounded-xl border border-outline-variant bg-surface-container text-sm focus:outline-none focus:ring-2 focus:ring-secondary/40"
        />
        <p className="text-xs text-on-surface-variant mt-2">レビューとバナー生成に同じAPIキーが使用されます。ブラウザに保存されます。</p>
      </div>

      {/* ─── Step 1: Upload ─── */}
      <div className="bg-surface-container-lowest rounded-2xl shadow-[0_24px_48px_-12px_rgba(26,26,46,0.08)] p-6">
        <h3 className="text-lg font-bold text-[#1A1A2E] japanese-text mb-4 flex items-center gap-2">
          <span className="w-7 h-7 bg-secondary/10 rounded-lg flex items-center justify-center text-secondary text-sm font-extrabold">1</span>
          バナー画像アップロード
        </h3>

        {/* Drop zone - show only in idle or error with no asset */}
        {(!isUploaded && phase !== 'uploading') && (
          <div
            ref={dropZoneRef}
            onClick={() => fileInputRef.current?.click()}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            className="border-2 border-dashed border-outline-variant rounded-xl p-10 flex flex-col items-center justify-center cursor-pointer hover:border-secondary hover:bg-secondary/5 transition-all"
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

        {/* Uploading spinner */}
        {phase === 'uploading' && (
          <div className="flex flex-col items-center py-8 gap-3">
            {previewUrl && <img src={previewUrl} alt="プレビュー" className="w-48 h-auto rounded-xl opacity-60" />}
            <LoadingSpinner label="アップロード中…" />
          </div>
        )}

        {/* Upload complete — preview + meta */}
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
        <div className="bg-surface-container-lowest rounded-2xl shadow-[0_24px_48px_-12px_rgba(26,26,46,0.08)] p-6 space-y-4">
          <h3 className="text-lg font-bold text-[#1A1A2E] japanese-text mb-2 flex items-center gap-2">
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
                className="w-full px-4 py-2.5 rounded-xl border border-outline-variant bg-surface-container text-sm focus:outline-none focus:ring-2 focus:ring-secondary/40"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-on-surface-variant mb-1">LP URL（任意 — 入力するとLP統合レビュー）</label>
              <input
                type="url"
                value={lpUrl}
                onChange={(e) => setLpUrl(e.target.value)}
                placeholder="https://example.com/lp"
                className="w-full px-4 py-2.5 rounded-xl border border-outline-variant bg-surface-container text-sm focus:outline-none focus:ring-2 focus:ring-secondary/40"
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
              className="w-full px-4 py-2.5 rounded-xl border border-outline-variant bg-surface-container text-sm focus:outline-none focus:ring-2 focus:ring-secondary/40 resize-none"
            />
          </div>

          <button
            onClick={handleReview}
            disabled={!apiKey.trim() || phase === 'reviewing'}
            className="px-6 py-3 bg-primary text-on-primary rounded-xl font-bold flex items-center gap-2 hover:opacity-90 transition-all text-sm disabled:opacity-40 disabled:cursor-not-allowed"
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

      {/* ─── Step 3: Review Result ─── */}
      {isReviewed && reviewResult && (
        <div className="bg-surface-container-lowest rounded-2xl shadow-[0_24px_48px_-12px_rgba(26,26,46,0.08)] p-6 space-y-4">
          <h3 className="text-lg font-bold text-[#1A1A2E] japanese-text mb-2 flex items-center gap-2">
            <span className="w-7 h-7 bg-secondary/10 rounded-lg flex items-center justify-center text-secondary text-sm font-extrabold">3</span>
            レビュー結果
          </h3>

          {/* Score if available */}
          {reviewResult.overall_score != null && (
            <div className="flex items-center gap-3 mb-2">
              <span className="text-3xl font-extrabold text-secondary">{reviewResult.overall_score}</span>
              <span className="text-sm text-on-surface-variant">/ 100</span>
            </div>
          )}

          {/* Review sections */}
          <div className="bg-surface-container rounded-xl p-5 text-sm text-on-surface whitespace-pre-wrap leading-relaxed max-h-[500px] overflow-y-auto">
            {typeof reviewResult === 'string'
              ? reviewResult
              : reviewResult.summary || reviewResult.markdown || JSON.stringify(reviewResult, null, 2)}
          </div>

          {runId && (
            <p className="text-xs text-on-surface-variant/50 font-mono">run_id: {runId}</p>
          )}

          {/* Generation button */}
          {runId && (
            <button
              onClick={handleGenerate}
              disabled={!apiKey.trim() || phase === 'generating'}
              className="px-6 py-3 bg-secondary text-on-secondary rounded-xl font-bold flex items-center gap-2 hover:opacity-90 transition-all text-sm disabled:opacity-40 disabled:cursor-not-allowed"
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
        <div className="bg-surface-container-lowest rounded-2xl shadow-[0_24px_48px_-12px_rgba(26,26,46,0.08)] p-6 space-y-4">
          <h3 className="text-lg font-bold text-[#1A1A2E] japanese-text mb-2 flex items-center gap-2">
            <span className="w-7 h-7 bg-green-100 rounded-lg flex items-center justify-center text-green-700 text-sm font-extrabold">4</span>
            改善バナー
          </h3>

          <div className="flex flex-col items-center gap-4">
            <img
              src={genImageUrl}
              alt="生成されたバナー"
              className="max-w-full max-h-[500px] rounded-xl border border-outline-variant shadow-md"
            />
            <div className="flex gap-3">
              <a
                href={genImageUrl}
                download={`banner-${genId}.png`}
                className="px-5 py-2.5 bg-primary text-on-primary rounded-xl font-bold flex items-center gap-2 hover:opacity-90 transition-all text-sm"
              >
                <span className="material-symbols-outlined text-lg">download</span>
                ダウンロード
              </a>
              <button
                onClick={resetAll}
                className="px-5 py-2.5 bg-surface-container text-on-surface rounded-xl font-bold flex items-center gap-2 hover:bg-surface-container-high transition-all text-sm"
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
        <div className="bg-surface-container-lowest rounded-2xl shadow-[0_24px_48px_-12px_rgba(26,26,46,0.08)] p-8">
          <h3 className="text-lg font-bold text-[#1A1A2E] japanese-text mb-6 flex items-center gap-2">
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
                <div className="w-12 h-12 bg-secondary/10 rounded-xl flex items-center justify-center mb-3">
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

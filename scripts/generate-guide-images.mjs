/**
 * Insight Studio Guide Infographic Generator
 *
 * Gemini 3.1 Flash Image Preview API を使って
 * ガイド用インフォグラフィック PNG を事前生成するスクリプト。
 *
 * Usage: node scripts/generate-guide-images.mjs
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const OUT_DIR = path.join(ROOT, 'public', 'guide')

// .env を手動パース（dotenv不要）
function loadEnv() {
  const envPath = path.join(ROOT, '.env')
  if (!fs.existsSync(envPath)) throw new Error('.env file not found')
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n')
  const env = {}
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    let val = trimmed.slice(eqIdx + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    env[key] = val
  }
  return env
}

const env = loadEnv()
const API_KEY = env.IMAGE_API_KEY
const API_ENDPOINT = env.IMAGE_API_ENDPOINT

if (!API_KEY || !API_ENDPOINT) {
  console.error('ERROR: IMAGE_API_KEY and IMAGE_API_ENDPOINT must be set in .env')
  process.exit(1)
}

const COMMON_STYLE = `
Style requirements:
- Japanese infographic poster style, professional and colorful
- Horizontal landscape layout (wider than tall, approximately 16:9 ratio)
- Use colorful section boxes with rounded corners (like sticky notes or cards)
- Clean white or very light gray background
- Use simple flat icons and step-by-step flow diagrams
- Color palette: Deep Navy (#1A1A2E), Muted Gold (#D4A843), with accent colors per section
- Font style: clean sans-serif, bold headings, clear hierarchy
- Include numbered steps where applicable
- All text must be in Japanese
- Professional SaaS dashboard documentation feel
- No anime or cartoon characters - keep it business/professional
`.trim()

const PAGES = [
  {
    filename: 'page1-welcome.png',
    prompt: `Create a Japanese infographic poster titled "Insight Studio へようこそ" (Welcome to Insight Studio).

Content sections:
1. Top banner: "Insight Studio" logo text with subtitle "広告運用・競合分析 AI ダッシュボード"
2. Three main pillars shown as large colorful cards in a row:
   - Card 1 (Blue): "LP比較・競合分析" with a magnifying glass icon - "AIがランディングページを分析し、競合と比較します"
   - Card 2 (Green): "広告パフォーマンス分析" with a bar chart icon - "Excel/BQデータからインサイトを自動生成"
   - Card 3 (Purple): "クリエイティブレビュー" with a palette icon - "バナー・LPをAIが診断し改善提案"
3. Bottom flow diagram: "設定 → 分析 → 改善" showing the overall workflow with arrows

${COMMON_STYLE}`,
  },
  {
    filename: 'page2-api-setup.png',
    prompt: `Create a Japanese infographic poster titled "APIキーの設定ガイド" (API Key Setup Guide).

Content sections:
1. Header: "はじめに：3つのキーを設定しましょう"
2. Three setup cards arranged horizontally:
   - Card 1 (Gold accent): "Claude API キー"
     - Icon: key symbol
     - Purpose: "AI分析・比較・チャット機能に使用"
     - Where: "Anthropic Console で取得"
     - Features unlocked: "Compare, Discovery, AI Explorer"
   - Card 2 (Blue accent): "Gemini API キー"
     - Icon: image symbol
     - Purpose: "バナー画像の自動生成に使用"
     - Where: "Google AI Studio で取得"
     - Features unlocked: "クリエイティブレビュー・バナー生成"
   - Card 3 (Green accent): "Ads Studio 認証"
     - Icon: lock symbol
     - Purpose: "広告データへのアクセス"
     - Where: "管理者からパスワードを取得"
     - Features unlocked: "広告分析・グラフ・AI Explorer"
3. Bottom flow: "キー取得 → Settings画面で入力 → 機能アンロック!" with checkmark icons

${COMMON_STYLE}`,
  },
  {
    filename: 'page3-lp-analysis.png',
    prompt: `Create a Japanese infographic poster titled "LP比較 & 競合発見" (LP Comparison & Discovery).

Content sections:
1. Left section (Blue theme) - "Compare（LP比較）":
   - Step 1: "URLを入力" with a text input icon
   - Step 2: "AIが自動分析" with a brain/AI icon
   - Step 3: "スコア比較" with a versus/comparison icon
   - Result preview: two cards side by side showing "自社 88点" vs "競合 74点"

2. Right section (Teal theme) - "Discovery（競合発見）":
   - Step 1: "自社URLを入力"
   - Step 2: "AIが競合を自動検索"
   - Step 3: "競合リストと分析レポート"
   - Visual: a funnel diagram showing URL → Search → Multiple competitor cards

3. Bottom tip box: "Claude APIキーが必要です。Settings画面で設定してください。"

${COMMON_STYLE}`,
  },
  {
    filename: 'page4-ads-insight.png',
    prompt: `Create a Japanese infographic poster titled "広告分析ワークフロー" (Ads Analysis Workflow).

Content sections:
1. Main flow diagram with 4 connected steps (horizontal arrows between each):
   - Step 1 (Gold): "Setup Wizard" - "データソースとクエリタイプを選択" with a wizard hat icon
   - Step 2 (Green): "Essential Pack" - "AIが自動でレポートを生成" with a document icon
   - Step 3 (Blue): "Analysis Graphs" - "データをグラフで可視化" with a chart icon
   - Step 4 (Purple): "AI Explorer" - "チャットで深掘り分析" with a chat bubble icon

2. Side panel - "クエリタイプ一覧":
   - List of query types: "パフォーマンス概要", "クリエイティブ分析", "ターゲティング分析", etc.
   - Each with a small colored dot

3. Bottom note: "Ads Studio認証 + Claude APIキーが必要です"

${COMMON_STYLE}`,
  },
  {
    filename: 'page5-creative.png',
    prompt: `Create a Japanese infographic poster titled "クリエイティブレビュー & バナー生成" (Creative Review & Banner Generation).

Content sections:
1. Top section - "レビューフロー" (Review Flow):
   - Step 1 (Orange): "画像をアップロード" with upload icon
   - Step 2 (Purple): "AIが分析・診断" with magnifying glass icon
   - Step 3 (Gold): "スコア & 改善提案" with star/rating icon
   - Visual: arrow flow connecting the steps

2. Middle section - "バナー自動生成" (Auto Banner Generation):
   - Left: "レビュー結果" card
   - Arrow pointing right with "Gemini (Nano Banana 2)" label
   - Right: "改善バナー" card with sparkle effect

3. Bottom section - two info boxes:
   - "レビュー: Claude APIキー使用" (blue accent)
   - "画像生成: Gemini APIキー使用" (gold accent)

${COMMON_STYLE}`,
  },
  {
    filename: 'page6-tips.png',
    prompt: `Create a Japanese infographic poster titled "便利な機能 & Tips" (Useful Features & Tips).

Content sections arranged in a 2x2 grid:

1. Top-left card (Amber): "サイドバーのカスタマイズ"
   - "ドラッグで幅を調整可能"
   - "ナビゲーションメニューから各画面に移動"
   - Visual: sidebar resize handle illustration

2. Top-right card (Blue): "テーマ切替"
   - "ライト/ダークモード対応"
   - "ヘッダー右上のアイコンで切替"
   - Visual: sun and moon icons

3. Bottom-left card (Green): "接続ステータス"
   - "サイドバー下部でAPI接続状況を確認"
   - "緑: 接続済み / 赤: 未接続"
   - Visual: status indicator dots

4. Bottom-right card (Purple): "キーボードショートカット"
   - "← → : ガイドページ送り"
   - "Esc : モーダルを閉じる"
   - Visual: keyboard keys illustration

${COMMON_STYLE}`,
  },
]

async function generateImage(prompt, retries = 2) {
  const url = `${API_ENDPOINT}?key=${API_KEY}`
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseModalities: ['IMAGE', 'TEXT'],
    },
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 120000)

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      clearTimeout(timeout)

      if (!res.ok) {
        const text = await res.text()
        throw new Error(`API error ${res.status}: ${text.slice(0, 200)}`)
      }

      const data = await res.json()
      const parts = data.candidates?.[0]?.content?.parts
      if (!parts) throw new Error('No candidates in response')

      const imagePart = parts.find((p) => p.inlineData?.mimeType?.startsWith('image/'))
      if (!imagePart) throw new Error('No image part in response')

      return Buffer.from(imagePart.inlineData.data, 'base64')
    } catch (err) {
      if (attempt < retries) {
        console.log(`  -> Retry ${attempt + 1}/${retries} after error: ${err.message}`)
        await new Promise((r) => setTimeout(r, 3000))
      } else {
        throw err
      }
    }
  }
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  console.log(`Generating ${PAGES.length} guide images...`)
  console.log(`Output: ${OUT_DIR}\n`)

  for (let i = 0; i < PAGES.length; i++) {
    const page = PAGES[i]
    const outPath = path.join(OUT_DIR, page.filename)
    console.log(`[${i + 1}/${PAGES.length}] Generating ${page.filename}...`)

    // Skip if already exists (use --force to regenerate)
    if (fs.existsSync(outPath) && !process.argv.includes('--force')) {
      const sizeKB = (fs.statSync(outPath).size / 1024).toFixed(1)
      console.log(`  -> Skipped (already exists, ${sizeKB} KB)`)
      continue
    }

    try {
      const imageBuffer = await generateImage(page.prompt)
      fs.writeFileSync(outPath, imageBuffer)
      const sizeKB = (imageBuffer.length / 1024).toFixed(1)
      console.log(`  -> Saved (${sizeKB} KB)`)
    } catch (err) {
      console.error(`  -> FAILED: ${err.message}`)
    }

    // Rate limiting: wait 2s between requests
    if (i < PAGES.length - 1) {
      await new Promise((r) => setTimeout(r, 2000))
    }
  }

  console.log('\nDone!')
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})

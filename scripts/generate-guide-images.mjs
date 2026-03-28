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
- Japanese infographic poster style, clean and visually appealing
- Horizontal landscape layout (16:9 ratio, wider than tall)
- Balanced layout: readable with comfortable spacing, but no large empty areas
- Use 2-3 colorful section boxes with pastel backgrounds (yellow #FFF9C4, blue #E3F2FD, green #E8F5E9, purple #F3E5F5, orange #FFF3E0)
- Each section has rounded corners, bold colored header, and 3-4 bullet points
- Include numbered steps, simple flow arrows (→), and small flat icons
- Visual hierarchy: large bold title, medium section headers, concise body text
- Color palette: Deep Navy (#1A1A2E) title, Muted Gold (#D4A843) accent, pastels for sections
- Font: clean sans-serif, bold headings, readable size (not too small)
- All text MUST be in Japanese
- Professional SaaS dashboard feel — informative but not overwhelming
- Each section should have 3-4 key points maximum — prioritize clarity over volume
`.trim()

const PAGES = [
  {
    filename: 'page1-welcome.png',
    prompt: `Create a Japanese infographic poster titled "Insight Studio ガイド" with subtitle "広告運用・競合分析 AI ダッシュボード".

Layout: 3-column cards + bottom flow strip.

LEFT CARD (pastel blue #E3F2FD):
Title: "1. LP比較・競合分析"
• AIがLPを自動スキャンし100点満点でスコアリング
• Compare: 自社 vs 競合のLP比較（最大3つ）
• Discovery: URLから競合を自動発見・リスト化
• 分析項目: レイアウト、CTA、コピー、モバイル対応

CENTER CARD (pastel green #E8F5E9):
Title: "2. 広告パフォーマンス分析"
• Excel/BigQueryデータからAIがインサイト生成
• 4ステップ: Setup → 要点パック → グラフ → AI考察
• チャート: 折れ線・棒・ドーナツ・エリア対応
• チャットでデータを深掘り質問可能

RIGHT CARD (pastel purple #F3E5F5):
Title: "3. クリエイティブレビュー"
• バナー・LPをAIが診断しスコア＆改善提案
• 4軸分析: レイアウト/ビジュアル/テキスト/CTA
• Gemini Nano Banana 2 で改善バナーを自動生成
• Claude（分析）+ Gemini（画像生成）の2AI連携

BOTTOM STRIP (white, full width, with arrow flow):
"Settings でAPIキー設定 → 機能を選択 → AI自動分析 → レポート＆改善提案"

${COMMON_STYLE}`,
  },
  {
    filename: 'page2-api-setup.png',
    prompt: `Create a Japanese infographic poster titled "APIキー設定ガイド" with subtitle "3つのキーで全機能をアンロック".

Layout: 3 equal column cards + bottom flow + small tip box.

Card 1 (pastel yellow #FFF9C4):
Title: "Claude API キー" (key icon)
• 用途: AI分析・比較・チャット全般
• 取得: Anthropic Console → API Keys → Create Key
• 有効化: LP比較, Discovery, AI Explorer, 要点パック
• 料金目安: 1回の分析で約¥30-50

Card 2 (pastel blue #E3F2FD):
Title: "Gemini API キー" (image icon)
• 用途: バナー画像の自動生成 (Nano Banana 2)
• 取得: Google AI Studio → Get API Key
• 有効化: クリエイティブレビューのバナー生成
• 料金目安: 1回の生成で約¥5-10

Card 3 (pastel green #E8F5E9):
Title: "Ads Studio 認証" (lock icon)
• 用途: 広告パフォーマンスデータへのアクセス
• 取得: 社内管理者からパスワードを取得
• 有効化: セットアップ, 要点パック, グラフ, AI Explorer

BOTTOM FLOW (pastel orange strip):
"① キー取得 → ② ヘッダー右の鍵アイコン → ③ 各キーを入力・保存 → ④ 全機能アンロック！"

TIP (small box, bottom right):
"Claude APIキーだけで主要機能の80%が使えます"

${COMMON_STYLE}`,
  },
  {
    filename: 'page3-lp-analysis.png',
    prompt: `Create a Japanese infographic poster titled "LP比較 & 競合発見" with subtitle "AIがランディングページを分析".

Layout: 2 equal columns + bottom note.

LEFT COLUMN (pastel blue #E3F2FD):
Title: "Compare（LP比較）"
使い方:
① URLを入力（自社＋競合、最大3つ）
② 「分析開始」をクリック
③ 30-60秒で結果表示

分析項目:
• 総合スコア（100点満点）: 自社 88点 vs 競合 74点
• レイアウト・ビジュアル・コピー・CTA・モバイル対応
• AI改善提案（優先度付き）

RIGHT COLUMN (pastel green #E8F5E9):
Title: "Discovery（競合発見）"
使い方:
① 自社URLを入力
② 「競合を検索」をクリック
③ AIが類似サービスを自動発見

出力:
• 競合サイトURL（最大10社を自動発見）
• 各競合のポジショニング分析
• 強み・弱みの比較、差別化ポイント

BOTTOM NOTE (pastel yellow strip):
"必要: Claude APIキー ｜ 対象: 公開ページのみ（認証付きページは不可）"

${COMMON_STYLE}`,
  },
  {
    filename: 'page4-ads-insight.png',
    prompt: `Create a Japanese infographic poster titled "広告分析ワークフロー" with subtitle "4ステップで広告データを分析".

Layout: Top flow diagram + 2x2 card grid + side list.

TOP (full width, navy strip):
Flow: "① Setup Wizard → ② Essential Pack → ③ Analysis Graphs → ④ AI Explorer"

Card 1 (pastel yellow #FFF9C4):
Title: "① Setup Wizard"
• データソース選択（Excel / BigQuery）
• クエリタイプ・期間・キャンペーン指定
• 初回のみ設定、次回以降は省略可

Card 2 (pastel green #E8F5E9):
Title: "② Essential Pack"
• AIがKPI要約・トレンド・改善提案を自動生成
• CPA, ROAS, CVR, CTR等のサマリー
• 約20-40秒で生成完了

Card 3 (pastel blue #E3F2FD):
Title: "③ Analysis Graphs"
• 折れ線・棒・ドーナツ・エリアチャート
• 期間フィルター、グループ別表示
• AIがデータ特性からチャートタイプを自動選択

Card 4 (pastel purple #F3E5F5):
Title: "④ AI Explorer"
• チャットで「先月CPAが上がった原因は？」等を質問
• データ参照＋AI回答、フォローアップ質問OK

SIDE LIST (pastel orange, narrow):
"クエリタイプ": パフォーマンス概要 / クリエイティブ / ターゲティング / デバイス / 時間帯 / 地域

BOTTOM NOTE: "必要: Ads Studio認証 + Claude APIキー"

${COMMON_STYLE}`,
  },
  {
    filename: 'page5-creative.png',
    prompt: `Create a Japanese infographic poster titled "クリエイティブレビュー & バナー生成" with subtitle "AIによる診断と自動改善".

Layout: Left section + center section + right section + bottom strip.

LEFT SECTION (pastel orange #FFF3E0):
Title: "レビューフロー"
① 画像をアップロード（PNG, JPG, WebP対応）
② AIが自動分析（20-40秒）
③ 診断結果: 総合スコア 86/100点

4軸で分析:
• レイアウト設計（構造、視線誘導）
• ビジュアル表現（色彩、コントラスト）
• テキスト戦略（見出し、訴求力）
• CTA効果（配置、サイズ、テキスト）

CENTER SECTION (pastel purple #F3E5F5):
Title: "バナー自動生成"
Flow: "レビュー結果 → Gemini Nano Banana 2 → 改善バナー"
• 改善ポイントをプロンプトに変換して画像生成
• 元のデザインテイストを維持しつつ改善
• 生成時間: 約30-60秒

RIGHT SECTION (pastel green #E8F5E9):
Title: "出力形式"
• レーダーチャート（4軸の視覚化）
• 改善提案リスト（優先度: 高/中/低）
• 生成バナー画像（ダウンロード可能）

BOTTOM STRIP (2 boxes side by side):
Blue box: "レビュー: Claude APIキー使用"
Gold box: "画像生成: Gemini APIキー使用"

${COMMON_STYLE}`,
  },
  {
    filename: 'page6-tips.png',
    prompt: `Create a Japanese infographic poster titled "便利な機能 & Tips" with subtitle "Insight Studio を使いこなすヒント".

Layout: 2x2 grid of tip cards + bottom FAQ strip.

Card 1 (pastel yellow #FFF9C4):
Title: "サイドバー"
• ドラッグで幅を調整（200-400px）
• メニュー: ダッシュボード / LP分析 / 広告考察 / 設定
• 下部にAPI接続ステータスを常時表示

Card 2 (pastel blue #E3F2FD):
Title: "テーマ切替"
• ヘッダー右上の太陽/月アイコンで切替
• ダーク: 夜間作業向け / ライト: プレゼン向け
• 設定はブラウザに自動保存

Card 3 (pastel green #E8F5E9):
Title: "接続ステータス"
• サイドバー下部: Claude / Gemini / Ads の3つ
• 緑 = 接続済み / 赤 = 未接続
• クリックでSettings画面へジャンプ

Card 4 (pastel pink #FCE4EC):
Title: "ガイド & セキュリティ"
• ヘッダー右の本アイコンでガイドを開く
• ← → キーでページ送り、Esc で閉じる
• APIキーはlocalStorage保存（サーバー送信なし）

BOTTOM FAQ (light gray strip, full width):
Q: 料金は？ → API利用料のみ（分析¥30-50、画像生成¥5-10）
Q: スマホ対応？ → PC専用（1280px以上推奨）

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

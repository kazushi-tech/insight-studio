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
CRITICAL STYLE REQUIREMENTS - Follow these exactly:
- Dense, information-rich Japanese academic poster / research poster style
- Horizontal WIDE landscape layout (16:9 ratio, much wider than tall)
- DENSE layout: fill the entire poster with content, NO large empty spaces
- Multiple colored section boxes with DIFFERENT background colors: use pastel yellow (#FFF9C4), pastel pink (#FCE4EC), pastel green (#E8F5E9), pastel blue (#E3F2FD), pastel purple (#F3E5F5), pastel orange (#FFF3E0)
- Each section box has rounded corners, slight shadow, and a bold colored header/title
- Include MANY bullet points, numbered steps, small diagrams, flow arrows, and icon symbols within each section
- Use visual hierarchy: large bold title at top, medium section headers, small body text with bullets
- Include small illustrative diagrams, flow charts with arrows (→), comparison tables, and data visualizations
- Color palette: Deep Navy (#1A1A2E) for main title, Muted Gold (#D4A843) accent, colorful pastels for sections
- Font: clean sans-serif, mix of bold headings and regular body text
- All text MUST be in Japanese (日本語で書くこと)
- Professional SaaS documentation feel like a conference research poster
- Pack information densely like an academic poster - every section should have 4-6 bullet points minimum
- Use 3-column or mixed grid layout to maximize information density
`.trim()

const PAGES = [
  {
    filename: 'page1-welcome.png',
    prompt: `Create a dense Japanese infographic research poster titled "Insight Studio 完全ガイド" with subtitle "広告運用・競合分析 AI ダッシュボード".

Layout: 3-column dense poster with colored sections.

LEFT COLUMN (pastel blue background section):
Title: "1. LP比較・競合分析"
- 機能概要: AIがランディングページを自動スキャン・分析
- Compare: 最大3つのLPを並べてスコア比較（100点満点）
- Discovery: 自社URLから競合を自動発見・リスト化
- 分析項目: レイアウト構成、ビジュアルアイデンティティ、コピーライティング、CTA配置、モバイル対応
- 出力: スコアカード、改善提案レポート、PDF出力対応
- 使用AI: Claude Sonnet 4.6（高品質テキスト分析）

CENTER COLUMN (pastel green background section):
Title: "2. 広告パフォーマンス分析"
- 機能概要: Excel/BigQueryデータからAIインサイト自動生成
- Setup Wizard: データソース選択 → クエリタイプ選択 → 期間指定
- Essential Pack: AIが自動でKPI要約・トレンド分析レポートを生成
- Analysis Graphs: 折れ線・棒・ドーナツ・エリアチャートで可視化
- AI Explorer: チャット形式でデータを深掘り質問可能
- クエリ種類: パフォーマンス概要、クリエイティブ分析、ターゲティング分析、デバイス分析、時間帯分析、地域分析

RIGHT COLUMN (pastel purple background section):
Title: "3. クリエイティブレビュー"
- 機能概要: バナー・LPをAIが診断し改善提案
- レビュー: 画像アップ → AI分析 → 86/100点のスコア＆詳細診断
- 分析軸: レイアウト設計、視覚的訴求力、テキスト戦略、CTAの効果
- バナー生成: レビュー結果をもとにAIが改善バナーを自動生成
- 使用AI: Claude（分析）+ Gemini Nano Banana 2（画像生成）
- 出力: レーダーチャート、改善ポイントリスト、生成バナー画像

BOTTOM STRIP (white background, full width):
Overall flow diagram with arrows: "Settings でAPI設定 → 分析機能を選択 → AI自動分析 → レポート＆改善提案 → 実行＆効果測定"
Small icons between each step.

${COMMON_STYLE}`,
  },
  {
    filename: 'page2-api-setup.png',
    prompt: `Create a dense Japanese infographic research poster titled "APIキー設定 完全ガイド" with subtitle "3つのキーで全機能をアンロック".

Layout: Top section + 3 large column cards + bottom flow + tips section.

TOP HEADER (navy background, white text):
"はじめに：3つのAPIキーを設定して、Insight Studioの全機能を有効化しましょう"

THREE LARGE CARDS (equal width columns):

Card 1 (Gold/Yellow background #FFF9C4):
Title: "Claude API キー" with key icon
- 用途: テキスト分析・比較・チャット全般に使用
- 取得先: Anthropic Console (console.anthropic.com)
- 取得手順:
  ① Anthropicアカウント作成（無料）
  ② ダッシュボードから「API Keys」を選択
  ③ 「Create Key」でキーを生成
  ④ キーをコピーしてSettings画面に貼り付け
- 有効化される機能:
  • LP比較 (Compare)
  • 競合発見 (Discovery)
  • AI考察 (AI Explorer)
  • Essential Pack レポート生成
- 料金目安: 1回の分析で約¥30-50（Sonnet 4.6）
- 注意: キーは外部に漏らさないでください

Card 2 (Blue background #E3F2FD):
Title: "Gemini API キー" with image icon
- 用途: バナー画像の自動生成（Nano Banana 2）
- 取得先: Google AI Studio (aistudio.google.com)
- 取得手順:
  ① Googleアカウントでログイン
  ② 「Get API Key」をクリック
  ③ プロジェクトを選択してキー生成
  ④ キーをコピーしてSettings画面に貼り付け
- 有効化される機能:
  • クリエイティブレビューのバナー生成
  • AI画像改善提案の視覚化
- 料金目安: 1回の生成で約¥5-10（Flash）

Card 3 (Green background #E8F5E9):
Title: "Ads Studio 認証" with lock icon
- 用途: 広告パフォーマンスデータへのアクセス
- 取得先: 社内管理者からパスワードを取得
- 設定手順:
  ① Settings画面の「Ads Studio 認証」セクションへ
  ② 管理者から受け取ったパスワードを入力
  ③ 「認証」ボタンをクリック
- 有効化される機能:
  • セットアップウィザード
  • 要点パック (Essential Pack)
  • 分析グラフ
  • AI Explorer（広告データ用）
- 注意: パスワードは定期的に変更される場合あり

BOTTOM FLOW (full width, pastel orange):
設定フロー図: "① キー取得" → "② Settings画面を開く（ヘッダー右の鍵アイコン）" → "③ 各キーを入力" → "④ 保存" → "⑤ 緑チェックマークで確認" → "全機能アンロック！"

TIPS BOX (bottom right, small):
- Claude APIキーだけでも主要機能の80%が使えます
- Gemini APIキーはバナー生成時のみ必要
- キーはブラウザのlocalStorageに保存（サーバーには送信されません）

${COMMON_STYLE}`,
  },
  {
    filename: 'page3-lp-analysis.png',
    prompt: `Create a dense Japanese infographic research poster titled "LP比較 & 競合発見 機能詳細" with subtitle "AIがランディングページを徹底分析".

Layout: 2-column main content + bottom comparison table + tips.

LEFT COLUMN (pastel blue #E3F2FD):
Title: "Compare（LP比較分析）"

Subsection "使い方フロー":
① 「LP比較分析」ページへ移動（サイドバーから選択）
② 比較したいLPのURLを入力（最大3つ：自社＋競合2社）
③ 「分析開始」ボタンをクリック
④ AIが各LPを自動スキャン・スクリーンショット取得
⑤ 30-60秒で分析結果が表示される

Subsection "分析される項目"（箇条書き）:
• 総合スコア（100点満点）
• レイアウト設計: 情報構造、視線誘導、余白バランス
• ビジュアル: 色使い、画像品質、ブランド一貫性
• コピーライティング: 見出し効果、訴求力、読みやすさ
• CTA分析: 配置、色のコントラスト、テキスト内容
• モバイル最適化: レスポンシブ対応、タッチターゲット
• ページ速度への影響要因

Subsection "出力形式":
- スコアカード（自社 88点 vs 競合A 74点 vs 競合B 69点）
- 項目別レーダーチャート
- AI改善提案（優先度付き）
- PDF出力対応

RIGHT COLUMN (pastel teal #E0F2F1):
Title: "Discovery（競合発見）"

Subsection "使い方フロー":
① 「競合発見」ページへ移動
② 自社のLPまたはサービスURLを入力
③ 「競合を検索」ボタンをクリック
④ AIがWeb検索で類似サービスを自動発見
⑤ 競合リストと各社の分析レポートが生成

Subsection "自動検出される情報":
• 競合サイトURL（最大10社を自動発見）
• 各競合のLP構成分析
• 価格帯・ポジショニングの比較
• ターゲット層の推定
• 強み・弱みの分析（SWOT的）
• 差別化ポイントの抽出

Subsection "活用例":
- 新規LP作成前の市場調査
- リニューアル時の競合ベンチマーク
- 広告戦略立案のための競合把握

BOTTOM SECTION (full width, pastel yellow):
Title: "比較表: Compare vs Discovery"
Table with columns: 機能 | Compare | Discovery
Rows: 目的, 入力, 分析対象, 出力, 所要時間, 必要なAPIキー

TIPS (small box, bottom right, pastel pink):
- 必要なAPIキー: Claude API キー
- 分析精度: Claude Sonnet 4.6による高精度分析
- 注意: URLは公開ページのみ対象（認証付きページは不可）

${COMMON_STYLE}`,
  },
  {
    filename: 'page4-ads-insight.png',
    prompt: `Create a dense Japanese infographic research poster titled "広告分析ワークフロー 完全ガイド" with subtitle "4ステップで広告データを完全分析".

Layout: Top flow diagram + 4 detailed cards (2x2 grid) + side panel + bottom notes.

TOP SECTION (full width, navy background):
Large flow diagram with 4 numbered circles connected by arrows:
"① Setup Wizard" → "② Essential Pack" → "③ Analysis Graphs" → "④ AI Explorer"
Each with a small icon.

FOUR DETAIL CARDS (2x2 grid):

Card 1 (Pastel gold #FFF9C4):
Title: "① Setup Wizard（セットアップ）"
- 目的: 分析対象データと条件を設定する初期設定画面
- 手順:
  1. データソースを選択（Excel / BigQuery）
  2. クエリタイプを選択（下記参照）
  3. 分析期間を指定（月別 or カスタム期間）
  4. 対象キャンペーン/アカウントを選択
  5. 「分析開始」で次のステップへ
- ポイント: 最初の1回だけ設定すれば次回以降は省略可能

Card 2 (Pastel green #E8F5E9):
Title: "② Essential Pack（要点パック）"
- 目的: AIが自動生成するサマリーレポート
- 含まれる内容:
  • KPI概要（CPA, ROAS, CVR, CTR等）
  • 期間比較トレンド分析
  • 注目ポイント＆異常値検出
  • AIによる改善提案（優先度付き）
  • アクションアイテムリスト
- 所要時間: 約20-40秒で生成完了
- 形式: マークダウン形式のAIレポート

Card 3 (Pastel blue #E3F2FD):
Title: "③ Analysis Graphs（分析グラフ）"
- 目的: データをビジュアルで俯瞰する
- チャート種類:
  • 折れ線グラフ（トレンド推移）
  • 横棒グラフ（カテゴリ比較）
  • ドーナツチャート（構成比）
  • エリアチャート（累積推移）
- 操作: 期間フィルター、グループ別表示、拡大表示
- AI推論: データ特性に基づいてチャートタイプを自動選択

Card 4 (Pastel purple #F3E5F5):
Title: "④ AI Explorer（AI考察）"
- 目的: チャット形式でデータを深掘り
- 使い方:
  1. 自然言語で質問を入力
  2. AIがデータを参照して回答生成
  3. フォローアップ質問で深掘り可能
- 質問例:
  • 「先月のCPAが上がった原因は？」
  • 「最もROASが高いクリエイティブは？」
  • 「週末と平日でCVRに差はある？」
- 対応: マークダウン形式、表・リスト含む回答

RIGHT SIDE PANEL (pastel orange #FFF3E0, narrow):
Title: "クエリタイプ一覧"
• パフォーマンス概要（全体KPI）
• クリエイティブ分析（素材別）
• ターゲティング分析（セグメント別）
• デバイス分析（PC/SP別）
• 時間帯分析（時間×曜日）
• 地域分析（エリア別）
• リターゲティング分析
• 予算最適化分析

BOTTOM STRIP (pastel pink):
必要な認証: Ads Studio パスワード + Claude API キー
注意: 大量データの場合は分析に1-2分かかる場合があります

${COMMON_STYLE}`,
  },
  {
    filename: 'page5-creative.png',
    prompt: `Create a dense Japanese infographic research poster titled "クリエイティブレビュー & バナー生成 詳細ガイド" with subtitle "AIによるクリエイティブ診断と自動改善".

Layout: 3-section horizontal layout + bottom details.

LEFT SECTION (pastel orange #FFF3E0):
Title: "レビューフロー（診断）"
Large numbered flow (vertical):
① 画像をアップロード
   - 対応形式: PNG, JPG, WebP
   - バナー画像 or LP全体のスクリーンショット
   - ファイルサイズ上限: 10MB

② AIが自動分析（20-40秒）
   - Claude Sonnet 4.6 が画像を解析
   - マルチモーダル分析（テキスト＋ビジュアル同時）

③ 診断結果を表示
   - 総合スコア: 86/100点
   - 予測バウンス率: 24.2%
   - 推定CVR: 3.8%

分析される4つの軸:
• レイアウト設計（情報構造、視線誘導、余白）
• ビジュアル表現（色彩、コントラスト、画像品質）
• テキスト戦略（見出し、本文、訴求力）
• CTA効果（配置、サイズ、色、テキスト）

CENTER SECTION (pastel purple #F3E5F5):
Title: "バナー自動生成"
Flow diagram:
"レビュー結果" → [Gemini Nano Banana 2] → "改善バナー画像"

生成の仕組み:
- レビューで特定された改善ポイントをプロンプトに変換
- Gemini 3.1 Flash Image Previewが画像を生成
- 元のデザインテイストを維持しつつ改善
- 生成時間: 約30-60秒

生成パラメータ:
• スタイル維持度: 元バナーのカラー・レイアウトを踏襲
• 改善フォーカス: スコアが低い項目を優先的に改善
• バリエーション: 1回の生成で1案を提示

RIGHT SECTION (pastel green #E8F5E9):
Title: "プロフェッショナル推薦"
- レビュー完了後に専門家視点のコメントを生成
- 改善の優先順位付きアクションリスト
- Before/After 形式での比較説明

出力形式:
• レーダーチャート（4軸の視覚化）
• 詳細テキストレポート（各軸の解説）
• タグチップ（キーワードハイライト）
• 改善提案リスト（優先度: 高/中/低）
• 生成バナー画像（ダウンロード可能）

BOTTOM STRIP (full width, 2 colored boxes side by side):
Left box (pastel blue): "レビュー（診断）: Claude APIキー使用 — テキスト分析・スコアリング・改善提案"
Right box (pastel gold): "画像生成: Gemini APIキー使用 — バナーの自動生成・ビジュアル改善"
Note: "両方のAPIキーがあれば診断→生成の一気通貫ワークフローが可能"

${COMMON_STYLE}`,
  },
  {
    filename: 'page6-tips.png',
    prompt: `Create a dense Japanese infographic research poster titled "便利な機能 & Tips 集" with subtitle "Insight Studio を使いこなすためのヒント".

Layout: 2x3 grid of colored tip cards + bottom FAQ section.

Card 1 (Pastel amber #FFF9C4):
Title: "サイドバーのカスタマイズ"
• ドラッグで幅を自由に調整（200px〜400px）
• キーボード ← → でも10pxずつ調整可能
• 設定した幅はブラウザに自動保存される
• ナビゲーション構造:
  - ダッシュボード（トップページ）
  - 競合LP分析 → LP比較 / 競合発見 / クリエイティブ診断
  - 広告考察 → セットアップ / 要点パック / グラフ / AI考察
  - 設定
• サイドバー下部: API接続ステータスを常時表示

Card 2 (Pastel blue #E3F2FD):
Title: "テーマ切替（ライト/ダーク）"
• ヘッダー右上の太陽/月アイコンで切替
• ダークモード: 目の疲れを軽減、夜間作業に最適
• ライトモード: プレゼンテーション、画面共有時に推奨
• サイドバーはダーク固定（Deep Navy #1A1A2E）
• テーマ設定はブラウザに保存される
• 全ページでテーマが即座に反映

Card 3 (Pastel green #E8F5E9):
Title: "接続ステータスの見方"
• サイドバー最下部に3つのステータスを表示:
  - Claude API: 分析機能の接続状態
  - Gemini API: 画像生成の接続状態
  - Ads Studio: 広告データの認証状態
• 色の意味:
  - 🟢 緑 = 接続済み・正常
  - 🔴 赤 = 未接続・要設定
• クリックでSettings画面に直接ジャンプ

Card 4 (Pastel pink #FCE4EC):
Title: "ガイドの使い方"
• ヘッダー右の本アイコン（menu_book）でいつでも開ける
• ← → キーでページ送り
• Esc キーで閉じる
• 下部のドットで任意のページにジャンプ
• 「次回から表示しない」チェックで自動表示OFF
• Settings画面からいつでも再表示可能

Card 5 (Pastel purple #F3E5F5):
Title: "データの安全性"
• APIキーはブラウザのlocalStorageに保存
• サーバーにAPIキーは送信されません（バックエンドがプロキシ）
• 分析データは各バックエンドサーバーで処理
• ログアウトでAds Studioトークンは自動削除
• 定期的なパスワード変更を推奨

Card 6 (Pastel orange #FFF3E0):
Title: "トラブルシューティング"
• 「分析がタイムアウトする」→ 長いページは時間がかかります（最大120秒待機）
• 「バナーが生成されない」→ Gemini APIキーを確認してください
• 「広告データが表示されない」→ Ads Studio認証を確認
• 「スコアが表示されない」→ Claude APIキーが未設定の可能性
• 画面が崩れる場合 → ブラウザのキャッシュをクリアしてリロード

BOTTOM FAQ SECTION (full width, light gray background):
Title: "よくある質問"
Q: 料金はいくらかかりますか？ → A: API利用料のみ。1回の分析で約¥30-50（Claude）、画像生成で約¥5-10（Gemini）
Q: スマートフォンで使えますか？ → A: PC専用です。1280px以上の画面推奨。
Q: 分析結果は保存されますか？ → A: Compare/Discoveryの履歴は自動保存。広告分析はセッション中のみ。

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

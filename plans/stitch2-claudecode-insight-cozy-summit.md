# Stitch2 × Claude Code で作る新規 BPaaS プロダクト構想

**コードネーム:** `Cozy Summit`（ファイル名由来の仮称／最終名はローンチ前に決定）
**作成日:** 2026-04-17
**ステータス:** アイデア段階（Phase 0 / 方向性合意待ち）

---

## Context — なぜ今やるのか

- **Petabit本社がBPaaSに注力中**。insight-studio（広告運用SaaS）の次の一手として、BPaaS寄りの自社プロダクトを立ち上げたい。
- **Stitch 2.0 を活かしたい**。新しい意匠で差別化できるUIを前面に出す。
- **Claude Code で開発速度を最大化**できる今、3ヶ月で市場投入可能な規模のサービスを狙う。
- **insight-studio のBigQuery連携資産**を土台に、別ドメインへ展開する再投資効果を取りに行く。

### 補足: BPaaS（Business Process as a Service）とは
> 「ツール（SaaS）」だけでなく「業務プロセスそのもの」をサブスクで提供するモデル。
> SaaS + BPO（業務代行）+ AI の組み合わせ。
> AI時代のBPaaSは、従来人手で行っていた分析・レポート・提案を AI が肩代わりし、人は判断と伴走に専念する。
> 料金は月額サブスクが基本。単なるツール販売より **顧客LTVが高く、解約率が低い** のが特徴。

---

## 推奨サービス案

### 🏆 メイン推奨: 中小EC/D2C事業者向け「AI経営ダッシュボード BPaaS」

> データ統合 + Claude月次レポート + 月1伴走コンサル を月額で提供。
> 「数字はあるが活かせていない」中小EC事業者を、AIと専門家の二人三脚で支援する。

### なぜこれがブルーオーシャンか

| 競合カテゴリ | 代表例 | 中小EC向けでの弱点 |
|---|---|---|
| 大手BI/CDP | Treasure Data / Snowflake / Domo | 高額（月額数十万〜）、導入半年 |
| 無料BI | Looker Studio | 設定・運用の敷居が高く、中小は挫折 |
| EC標準分析 | Shopify Analytics | 自社サイトのみ、広告・会計と統合不可 |
| 広告運用SaaS | Shirofune / Roboma | 広告最適化特化、経営俯瞰は苦手 |
| 経営ダッシュボード | Manageboard / Loglass | 会計中心、マーケと繋がらない |

→ **「中小EC × AI × 経営数字 × 伴走支援」** の象限は **未占有**。
→ 特に「AIが経営者向けに日本語で因果まで語る」プロダクトは国内でほぼ存在しない。

### BPaaSとしての3本柱

1. **Tech（SaaS）:** Shopify / GA4 / 広告3媒体 / 会計(freee・MF) を自動でBigQueryに集約し、Stitch2準拠のダッシュボードで可視化
2. **AI（代行）:** Claude Opus 4.7 が月次で「何が起きたか・なぜか・次は何をすべきか」を経営者向け日本語レポートとして生成
3. **Human（伴走）:** Petabitの専門家が月1回オンラインで定例セッション（AIレポートをもとに意思決定を支援）

---

## 対象顧客ペルソナ

- **事業規模:** 年商 5,000万〜10億円 の D2C / EC事業者
- **組織:** 社内に専任データアナリスト不在、マーケ担当1〜3名
- **広告:** 月30万〜300万円を複数媒体に投下
- **現状の痛み:** 各ツールの管理画面を行き来し、Excelで手集計、経営数字まで繋げられていない
- **支払可能額:** 月額 5万〜15万円（BPO1名雇うより圧倒的に安い）

---

## 3ヶ月ロードマップ

### Phase 1 — Month 1: データ基盤 + 認証 + Stripe課金
- マルチテナントDB設計（PostgreSQL）
- 認証（Clerk or Supabase Auth）
- BigQuery 取込: Shopify / GA4 / Google広告 / Meta広告
- Stripe Billing（月額プラン3段階）
- Stitch2 デザインの最小ダッシュボード（KPIサマリのみ）
- 社内向けパイロット 1社でドッグフーディング

### Phase 2 — Month 2: AIレポート機能
- Claude による月次経営レポート生成パイプライン
  - プロンプトキャッシュ活用でコスト最適化（Anthropic SDK）
  - ハルシネーション対策: 数値はSQL結果を強制的にコンテキスト注入
- Slack 連携（週次インサイトBot配信）
- レポートPDFエクスポート
- オンボーディングフロー（OAuth接続ウィザード）
- 顧客データ分離・監査ログ

### Phase 3 — Month 3: BPaaS 運用機能 + スケール準備
- 伴走コンサル予約機能（Google Calendar連携）
- Petabit社内オペレーター用管理画面（顧客状況一覧・AIレポート下書き編集）
- アーリーアクセス 3〜5社向けにクローズド提供開始
- ランディングページ + 事例ページ
- ヘルプセンター + FAQ

---

## insight-studio からの再利用資産

| 資産 | 場所 | 再利用ポイント |
|---|---|---|
| BigQuery 連携ユーティリティ | [backends/ads-insights/bq/](backends/ads-insights/bq/) | クライアント初期化、スキーマ、リトライ、ヘルスチェック |
| FastAPI ルーティング構成 | [backends/ads-insights/web/app/](backends/ads-insights/web/app/) | API レイヤ設計の雛形 |
| Render デプロイ構成 | [render.yaml](render.yaml) | 本番インフラ定義 |
| Vercel リライト | [vercel.json](vercel.json) | フロント→API プロキシ |
| Stitch2準拠UIコンポーネント | [src/components/](src/components/) | Layout・カード・テーマ |

**新規リポジトリとして切り出す前提**（insight-studioは広告運用に特化しているため）。
ただし共通部分はnpm/pip packageとして切り出し可能か Phase 1 終盤で検討。

---

## 技術スタック

| レイヤー | 技術 | 備考 |
|---|---|---|
| Frontend | Vite + React + Tailwind v4 + Stitch2 | insight-studio と同一 |
| Backend | Python / FastAPI | insight-studio と同一 |
| App DB | PostgreSQL (マルチテナント) | テナント ID を全テーブルに |
| Analytics DB | BigQuery (顧客別データセット) | コスト管理のためスロット上限設定 |
| AI | Claude Opus 4.7 + プロンプトキャッシュ | claude-opus-4-7 |
| 認証 | Clerk（推奨）or Supabase Auth | SSO対応容易 |
| 課金 | Stripe Billing | サブスク・請求書 |
| Deploy | Vercel (front) + Render Starter (API) | insight-studio と同構成 |

---

## 成功指標（Month 3 時点）

| 指標 | 目標 |
|---|---|
| 契約顧客数 | 3〜5社（アーリーアクセス） |
| MRR | ¥300,000 以上 |
| 月次レポート生成成功率 | 95% 以上 |
| 顧客NPS | 8 以上 |
| 解約率 | 0%（3ヶ月期間内） |

---

## 検証方法

1. **Phase 1 終了時**: 社内パイロット1社で実データを流し、ダッシュボードに正しい数字が出ること、Stripe課金が動くこと
2. **Phase 2 終了時**: Claude レポートが経営者向けに読める品質であること（数字乖離なし、因果の説明が妥当）を Petabit 内部で5件レビュー合格
3. **Phase 3 終了時**: 外部3社のオンボーディング完了、初月レポート配信成功、初回伴走コンサル実施

---

## 主な懸念 / 要検討事項

| 懸念 | 対応方針 |
|---|---|
| Shopify / 各広告APIのOAuth実装コスト大 | Phase 1 では Google広告 + Meta広告 + Shopify の3本に限定 |
| 中小顧客のBigQueryコスト | 顧客ごとのスロット上限＋クエリ課金制で赤字防止 |
| AIハルシネーション | SQL結果を構造化コンテキストで強制注入、数値生成は AI にさせない |
| プライバシー / 顧客データ分離 | テナント別 BigQuery データセット、行レベルセキュリティ |
| 既存 insight-studio との棲み分け | insight-studio は「広告代理店向け運用ツール」、Cozy Summit は「事業主向け経営ダッシュボード」と明確に差別化 |

---

## 次のステップ（この計画が承認されたら）

1. **MVP スコープ確定計画書** を別途作成（Phase 1 のタスク詳細分解）
2. **Stitch2 デザイン依頼** 着手（ダッシュボード・レポート・設定画面）
3. **パイロット顧客の特定**（Petabit社内 or 既存 insight-studio 顧客から1社）
4. **新規リポジトリ作成 + 技術 PoC**（BigQuery + Claude パイプラインの動作確認）

---

## サブ候補（メイン案を却下する場合の代替）

### B案: 広告代理店向け「AI運用オペレーター BPaaS」
代理店の運用担当者の作業（レポート・入稿・改善提案）をAI+人で代行するサービス。
→ Petabitの既存ノウハウ活用度は最高だが、市場競合（Shirofune等）が強い。

### C案: 士業・コンサル向け「クライアント分析レポート BPaaS」
顧客のGA4/広告/売上を統合しAIが提案書を自動生成。
→ 超ニッチで競合少ないが、市場規模が小さく単価も取りにくい。

---

**推奨理由まとめ:** A案（中小EC向け経営BPaaS）は、市場規模・競合空白・AI活用度・Petabit資産再利用度のバランスが最良。
Stitch2の意匠で経営者に"開きたくなる"UIを届けられる点で、Claude Code×Stitch2の技術スタックが最も活きる領域でもある。

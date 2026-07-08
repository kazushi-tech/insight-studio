# 広告管理画面 × Insight Studio 連携提案書（作成計画）

## Context

今日、上司に「広告管理画面と Insight Studio の連携」を提案する。
現状の BigQuery 連携は **GA4 のみ**（`backends/ads-insights/bq/queries.py` に GA4 の `events_*` テーブル向けクエリが11種）で、広告媒体側のデータは **Excel 手動アップロード → KPI 抽出** という運用。
この「BigQuery連携の一歩先」として、**媒体APIからBQへ直接データ集約 → Insight Studio を多媒体対応の広告分析ハブに育てる**構想を、わかりやすい Markdown 1枚で提示する。

## 成果物

- ファイル: `docs/proposals/insight-studio-integration-proposal.md`（提案書本体・新規作成）
- 形式: 上司に画面で見せる用の Markdown（GitHub / VSCode でプレビュー）
- 分量: **A4 換算 2〜3 枚相当**（スクロール1〜2画面）
- トーン: **ビジネス寄り・結論先出し**（ROI / 運用負荷削減 / 競争優位を前面、技術詳細は最小限）
- 媒体スコープ: **Google Ads を先行 PoC として具体化**。他媒体は「同じ仕組みで横展開可」と一行添える

## 読み手と目的

- **読み手**: 上司（事業責任者クラス想定 / 技術よりビジネス寄り）
- **ゴール**:
  1. 現状の立ち位置(「GA4のBQ連携までは来た」)を整理
  2. 「広告媒体も BQ に載せる」次の一歩の具体像を示す
  3. 連携媒体が増えると何が嬉しいのかをメリット一覧で訴求
  4. 段階的導入ロードマップを提示し「いきなり全部やらない」安心感を出す

## 提案書の構成（見出し案）

### 1. エグゼクティブサマリー（結論先出し）
- 1行で: 「BigQuery をハブにして広告媒体データを集約すれば、Insight Studio は Excel 手作業レポートから **全媒体横断のリアルタイム分析基盤** に進化する」
- 現状 → 次の一歩 → その先、の図解的箇条書き

### 2. いまの立ち位置（現状整理）
- ads-insights: Excel 手動アップロード → KPI 抽出 → AI インサイト生成
- market-lens-ai: LP / 競合スキャン → クリエイティブレビュー
- BigQuery 連携済み: **GA4 のみ**（PV / CV / 流入 / デバイス / LP / 異常検知 等 11 種のクエリ）
- 残課題: 媒体ごとの広告実績は Excel 依存 → 毎月の手動オペレーション、タイムラグ、媒体横断比較が不可

### 3. 提案: 広告管理画面 ↔ Insight Studio 連携（まず Google Ads から）
- **方針**: 広告媒体の実績を BigQuery に直接流し込み、Insight Studio が BQ から読む構造にする
- **第一弾は Google Ads に絞る**:
  - Google BigQuery Data Transfer Service で日次自動同期（公式機能・ノーコード）
  - 既存の Insight Studio が持つ BQ 連携基盤（GA4 で実績あり）をそのまま流用
  - **同じ仕組みで Yahoo!広告 / Meta / TikTok 等へ横展開可能**（Phase 2 以降）
- **既存資産をそのまま使える**:
  - GA4 用の BQ クライアント・認証・レポート生成エンジンが既に稼働中
  - 媒体クエリを追加するだけで新媒体に対応できる拡張設計

### 4. メリット（連携が増えるほど効く効能）
- **運用負荷**: Excel アップロード作業が消滅 → 月次 X 時間の削減
- **鮮度**: 日次(or 時間単位)で最新データ → 「遅報告」からの脱却
- **横断分析**: 媒体 × LP × CV を同じ BQ で JOIN → 真のクロスチャネル最適化
- **AI の精度**: market-lens-ai の LP・競合分析と統合し、**広告実績 × LP 品質 × 競合動向** を一気通貫で AI が示唆
- **拡張性**: 新媒体が増えるたびに価値が複利で伸びる（ハブ型のネットワーク効果）
- **顧客価値**: 案件横断でベンチマーク/ナレッジが蓄積 → 提案の説得力

### 5. 比喩セクション（上司に刺さる一枚絵）
- 「いまは **GA4 という1本の蛇口** が BQ に繋がっている状態」
- 「ここに Google Ads / Meta / TikTok…と蛇口を増やすと、BQ は **広告データの貯水池（データレイク）** になる」
- 「Insight Studio はその貯水池から好きに汲み上げて分析・レポート・AI提案を生むエンジン」

### 6. 段階的ロードマップ
- **Phase 1（PoC・1媒体）**: Google Ads を BQ Transfer で日次同期 → 既存 `/api/bq/*` にクエリ追加
- **Phase 2**: Meta / Yahoo 追加、ads-insights の Excel 経路と並走運用で差分検証
- **Phase 3**: 全媒体 + 自動アラート（`anomaly` クエリ応用） + クロスチャネルダッシュボード
- **Phase 4**: market-lens-ai と統合した「AI 運用コンサル」化

### 7. 想定リスクと対応（軽く）
- 媒体API仕様変更 → ETLレイヤーで吸収
- コスト（BQ スキャン量）→ パーティション + マテビューで制御
- セキュリティ → 既存の `GOOGLE_CREDENTIALS_JSON` SA 認証基盤を流用

### 8. 次アクション
- ✅ 上司合意 → Phase 1 対象媒体を決定（推奨: Google Ads）
- ✅ BQ Transfer 設定 + データセット命名規約策定
- ✅ `bq/queries.py` に媒体クエリ追加 → 1案件でドッグフード

## トーンと表現ルール

- 技術用語は最低限、ビジネス価値を主語に書く
- 絵文字は使わず、見出しと箇条書きで視覚的に整理
- コードは載せない（提案書なので）。代わりに「既に●●があるので流用可」と資産の存在を示す
- 脅しより **「いまのまま×/変えると◎」のコントラスト** で訴求

## 参照ファイル（根拠として提案書に脚注的に入れる要素）

- [backends/ads-insights/bq/queries.py](backends/ads-insights/bq/queries.py) — 既存 GA4 クエリ11種
- [backends/ads-insights/bq/client.py](backends/ads-insights/bq/client.py) — BQクライアント基盤
- [backends/ads-insights/web/app/backend_api.py](backends/ads-insights/web/app/backend_api.py) — `/api/bq/*` エンドポイント群
- [backends/market-lens-ai/web/app/routers/](backends/market-lens-ai/web/app/routers/) — LP/競合分析側の既存資産

## Verification（提案書完成後のチェック）

1. `docs/proposals/insight-studio-integration-proposal.md` を VSCode のプレビューで開き、見出しレベル・改行・リストが崩れないか目視
2. セクション 1 のエグゼクティブサマリーだけ読んで「結論が分かるか」を自己レビュー
3. 上司が15秒でスキャンしても主張が伝わる構成になっているか確認
4. （必要なら）`codex-review` skill でレビューして修正ループ

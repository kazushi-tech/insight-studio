# GA4 × ECDirect × BigQuery 連携デモ — 説明資料 & 実装ロードマップ

## Context

本社の開発者向けデモで「GA4をECDirectで分析したいが現状できていない」という課題に対し、
Insight Studio（ads-insights バックエンド）のBigQuery連携機能を使って解決策を提示する。
ECDirect 側の GA4 BigQuery Export はまだ未設定のため、設定手順からデモまでを段階的に整理する。

---

## 0. BigQuery とは（入門説明）

### 一言で言うと

> **Googleがやってる「超デカいデータ置き場」。大量のデータを自由な切り口で集計できる。**

**ℹ️ SQLって？**

データベースに「こういう条件でデータ出して」と指示する命令文のこと。  
例：「4月の購入者のうち、スマホで来た人の数を出して」みたいなお願いを書く言葉。  
**Insight Studioが裏で自動で組み立ててくれるので、利用者はSQLを書かなくてOK。**

### イメージで例えると

- **普通のDB** = お店のレジ（売れたら即記録。1件1件の読み書きが得意）
- **BigQuery** = 倉庫＋計算機（大量のログを溜めておいて、「先月の売上合計出して」みたいな集計を一瞬でやる）

普通のDBで億件を集計しようとすると固まるが、BigQueryはそういう「大量データをまとめて数える」のが本業。

### ざっくり違い

| | 普通のDB（MySQL等） | BigQuery |
| --- | --- | --- |
| 得意なこと | 1件ずつ保存・取り出し | 大量データの集計・分析 |
| サーバー | 自分で立てて動かし続ける | Google側が勝手にやってくれる |
| お金 | 動かしてる間ずっと | 調べた分だけ |

### GA4と組み合わせると何が嬉しい？

GA4はユーザーの行動を毎日ガンガン記録しているが、GA4の画面だけだと：

- データを全部見られない（自動でサンプリングされちゃう）
- 「スマホ × 東京 × 初回訪問」みたいな複雑な絞り込みが難しい
- 毎週手でエクスポート…が面倒

BigQueryに流し込めば、**SQLで自由に好きな切り口で分析できる**ようになる。

### お金かかる？

結論、ほぼタダ。内訳は以下のとおり：

- GA4 → BigQueryの転送：**無料**
- データ保管：月10GBまで無料
- 分析クエリ：月10TBまで無料

通常の中小規模ECサイトなら、まず無料枠に収まる。

---

## 1. なぜ Insight Studio？ — BigQuery単体との差

> 本社開発者に「BigQueryあれば十分じゃん」と返されたときの回答がここじゃ。

### 素のBigQueryだけで分析するとこうなる

毎回の分析サイクルでこれを繰り返す必要がある：

1. GCPコンソールを開く
2. SQLを書く（または過去のを探してコピペ＆書き換え）
3. 実行 → 結果は**ただの表**
4. CSVに落とす
5. Excel や Looker Studio でグラフを作る
6. 何が言えるのか自分で考察を書く

→ 毎回1〜2時間。しかも**SQLが書ける人しかできない**。

### Insight Studio を使うと

| やること | BigQuery単体 | Insight Studio |
| --- | --- | --- |
| 分析の切り口選び | SQLを書く | カードをクリック（11種から選ぶ） |
| 期間指定 | SQLに日付を埋める | カレンダーで選ぶ |
| グラフ化 | 別ツールで自作 | 自動で描画 |
| AIによる考察 | なし | Claude / Gemini が自動で解説文を生成 |
| 案件（クライアント）切替 | 都度手動 | 案件管理画面でワンクリック |
| 異常検知 | 毎回SQLで実装 | Z-scoreで急落・急騰を自動検出 |

### 独自の武器（デモで推すポイント）

**① AI自動考察（Claude / Gemini）**  
グラフのピーク・ボトム・急変動をまず自動検出 → それをAIに投げて**日本語の考察文**に仕上げる。  
「4月中旬にPVが急減、主因はスマホ流入の減少」みたいな文章がレポートに載るのが強み。BigQuery直接ではまず出せない付加価値。

**② 11種ワンクリック分析**  
PV / 流入 / CV / LP / デバイス / 時間帯 / ユーザー属性 / エンゲージメント / 検索 / **異常検知(Z-score)** / **オークション圧推定**。どれもSQL書かずに選ぶだけ。

**③ 案件（クライアント）ごとのBigQuery切り替え**  
案件管理画面で切り替えるとDataset IDごと切り替わる。代理店で複数顧客を扱うユースケースに強い。パスワード＋TOTP認証も案件単位。

**④ 広告データ（Excel）との同居**  
Google Ads / Meta広告の月次Excelも取り込み済み。GA4だけでなく**広告も合わせて**考察AIに投げられる。

### 正直ベース（聞かれたら答える弱点）

- PDFは `Ctrl+P` の印刷プレビュー止まり（共有URL発行は未実装）
- 円グラフ・ヒートマップは未対応（今は棒・線のみ）
- 広告×GA4の「同一グラフ上での重ね表示」はまだ未実装（考察文で横断するレベル）

### 一言でまとめると

> **BigQueryが"データ置き場"なら、Insight Studioは"分析から考察レポートまで一気通貫で出してくれる工場"。**

---

## 2. 全体アーキテクチャ

```
[ECDirectのGA4プロパティ]
    │
    │ BigQuery Export（GA4管理画面から設定、無料）
    ▼
[GCPのBigQueryデータセット]
    例: analytics_XXXXXXXXX.events_YYYYMMDD
    │
    │ BigQuery dataViewer 権限（サービスアカウントへ付与）
    ▼
[Insight Studio / ads-insights API]
    │  bq/auth.py → bq/queries.py → bq/ga4_extract.py
    │  (SQL 11種: PV・流入・CV・LP・デバイス・時間帯 等)
    ▼
[Chart.js レポート画面]
    SetupWizard → EssentialPack → 考察スタジオ
```

---

## 3. ECDirect 側でやること（設定手順）

### Step 1: GA4のBigQuery Exportを有効化
1. GA4管理画面 → 「管理」→「BigQueryのリンク」
2. GCPプロジェクトを作成 or 既存プロジェクトを指定
3. エクスポートタイプを「毎日」に設定
4. 完了すると `analytics_XXXXXXXXX` というデータセットが作られ、
   毎日 `events_YYYYMMDD` テーブルが蓄積される

> **備考**: GA4 360でなくても標準GA4でBigQuery Exportは無料で使える（2023年以降）

### Step 2: Insight Studio のサービスアカウントに権限付与
1. GCPコンソール → BigQuery → データセット → 「共有」
2. Insight Studio のサービスアカウント（メアド形式）を追加
3. 役割: `BigQuery データ閲覧者` (roles/bigquery.dataViewer)

### Step 3: Dataset ID を Insight Studio に登録
- 案件管理画面でプロジェクト作成時に Dataset ID を入力するだけ
- 例: `your-gcp-project-id.analytics_XXXXXXXXX`

---

## 4. Insight Studio で何ができるか（11種の分析）

| 分析タイプ | 内容 | SQLテンプレート |
|-----------|------|----------------|
| PV分析 | ページ別PV・UU推移 | queries.py: `pv_analysis` |
| 流入分析 | チャネル別セッション数 | queries.py: `traffic_analysis` |
| CV分析 | コンバージョン経路・率 | queries.py: `cv_analysis` |
| 異常検知 | PV急落・急騰アラート | queries.py: `anomaly_detection` |
| LP分析 | ランディングページ効果 | queries.py: `lp_analysis` |
| デバイス分析 | PC/スマホ/タブレット比 | queries.py: `device_analysis` |
| 時間帯分析 | 時間帯別トラフィック | queries.py: `hourly_analysis` |
| ユーザー属性 | 年齢・性別・地域 | queries.py: `user_attribute` |
| エンゲージメント | 滞在時間・回遊率 | queries.py: `engagement_analysis` |
| オークション圧分析 | 広告入札への影響 | queries.py: `auction_pressure` |

---

## 5. 現在の実装ステータス

| コンポーネント | ファイル | 状態 |
|--------------|---------|------|
| BigQuery認証 | `backends/ads-insights/bq/auth.py` | ✅ 完成 |
| GA4 SQLテンプレート11種 | `backends/ads-insights/bq/queries.py` | ✅ 完成 |
| DataFrame→グラフ変換 | `backends/ads-insights/bq/ga4_extract.py` | ✅ 完成 |
| Chart.jsビルダー | `backends/ads-insights/web/app/bq_chart_builder.py` | ✅ 完成 |
| SetupWizard UI | `src/pages/SetupWizard.jsx` | ✅ 完成 |
| Dataset ID入力フォーム | `src/pages/CaseManagement.jsx:96-100` | ✅ 完成 |
| **GA4Provider実装** | `backends/ads-insights/data_providers/factory.py:55-60` | ❌ NotImplementedError |

**残り工数: 半日程度**（GA4Providerを実装するだけで全機能が動く）

---

## 6. デモシナリオ（本社開発者向け）

1. **課題の確認**: 「GA4データをExcelに落として手分析は限界」
2. **BigQueryの説明**: セクション0の内容。倉庫の例え話 → GA4と組み合わせる嬉しさ
3. **「BigQueryだけでよくない？」への回答**: セクション1の内容。  
   BQ単体だと「SQL書く→CSV出す→グラフ作る→考察書く」を毎回やる必要がある。  
   Insight Studio はこれを全部自動化 + AI考察まで付く。
4. **アーキテクチャ説明**: セクション2の図を使い、BigQuery Exportで自動蓄積の仕組みを見せる
5. **権限付与の簡単さ**: GCP 1画面でサービスアカウントを追加するだけと説明
6. **画面デモ**: SetupWizard → 分析タイプ選択 → レポート生成（Dataset IDを本番か仮設定で） → AI考察まで見せる
7. **ネクストアクション提案**: 「まずBigQuery Exportを有効化 → Dataset IDを教えてもらう → 翌日から分析可能」

---

## 7. 実装ロードマップ（デモ後にやること）

### Phase 1: GA4Provider 実装（半日）
- `backends/ads-insights/data_providers/factory.py` の GA4Provider クラスを完成させる
- `DATA_PROVIDER=ga4` 環境変数で切り替わるようにする
- ECDirect の dataset_id を CaseManagement で登録 → 分析クエリが走る

### Phase 2: デモ環境構築（1日）
- 開発用 GCP プロジェクトにサンプルGA4データを投入
- Render staging 環境で動作確認
- ECDirect 担当者に Dataset ID と権限付与の手順書を共有

### Phase 3: 本番接続（ECDirect次第）
- ECDirect 側が BigQuery Export 設定完了
- サービスアカウント権限付与
- Dataset ID を Insight Studio に登録 → 即日分析開始

---

## 8. 伝えるべきポイント（本社開発者向け）

- **コスト**: BigQuery の読み取りクエリは月10GBまで無料。GA4 Export も無料。
- **セキュリティ**: 分析用サービスアカウントにはデータ閲覧権限のみ。書き込み不可。
- **実装不要**: ECDirect 側はGA4管理画面とGCPコンソールの設定のみ。コード変更なし。
- **即効性**: 権限付与から翌日には自動レポートが動く。

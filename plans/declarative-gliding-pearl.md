# Phase 3.1: EssentialPackクラッシュ修正 + Dashboard履歴404の堅牢化

## Context

現状の `EssentialPack.jsx` は `SECTIONS` を参照している一方で、コンポーネント内にその定義が存在しないため、
初回描画時点で `ReferenceError` が発生して画面全体が停止する。

また `Dashboard.jsx` は `getHistory()` を必ず実行するが、`/api/ml/history` が 404 の環境では
「履歴がない」のではなく「APIエラー」として扱われ、空状態 UI に到達できていない。

## レビュー結果

### 1. EssentialPack の修正案が不十分

元プランの `insights?.sections?.length >= 3` 判定だけでは、以下を防げない。

- `sections` は 3 要素あるが `metrics` / `devices` / `table` のいずれかが欠けるケース
- API が段階的に実装され、タイトルだけ返して明細配列が未実装のケース
- `sections[0]` などは存在するが `.map()` 対象が `undefined` のケース

この場合、`SECTIONS[0].metrics.map(...)` などで再び実行時エラーになる。

### 2. Dashboard の 404 判定が脆い

元プランの `e.message.includes('404')` 判定は、`src/api/marketLens.js` の実装と相性が悪い。

- API クライアントは `body.detail` があればそれをそのまま `Error.message` に採用する
- そのため 404 でもメッセージに `"404"` が含まれない可能性がある
- 将来ほかの画面でも同様の分岐が必要になったとき再利用できない

HTTP ステータスは API クライアント側で `error.status` として保持し、画面側はそれを見るべき。

### 3. 検証観点が不足している

元プランは「完全に壊れている現状」と「理想の成功ケース」しか見ていない。
今回の変更では、次の境界条件を検証対象に含める必要がある。

- `EssentialPack` が API 未実行でも落ちないこと
- `generateInsights()` が `report` だけ返しても落ちないこと
- `generateInsights()` が部分的な `sections` を返しても落ちないこと
- `history` が 404 のときだけ空状態へフォールバックし、500 やネットワーク障害は従来通りエラー表示すること

## 修正後の実施プラン

### 1. `src/pages/EssentialPack.jsx` のクラッシュ耐性を上げる

#### 方針

`SECTIONS` を単純復活させるのではなく、表示用のセクションデータを正規化してから描画する。
これにより「未定義参照の解消」と「不完全レスポンス耐性」を同時に満たす。

#### 変更内容

1. `FALLBACK_SECTIONS` をコンポーネント外に追加する
2. `normalizeSections(rawSections)` ヘルパーを追加する
3. `const displaySections = normalizeSections(insights?.sections)` を使う
4. JSX 内の `SECTIONS[...]` 参照を `displaySections[...]` に置き換える

#### 実装イメージ

```javascript
const FALLBACK_SECTIONS = [
  {
    icon: 'grid_view',
    title: '全体サマリー',
    subtitle: '主要指標の概況と前月比推移',
    metrics: [
      { label: '総表示回数', value: '1,240,500', change: '+8.2%' },
      { label: 'クリック数', value: '45,230', change: '+12.4%' },
      { label: '総コスト', value: '¥842,000', tag: '安定' },
    ],
  },
  {
    icon: 'person',
    title: 'トラフィック分析',
    subtitle: 'デバイス別・時間帯別の流入傾向',
    devices: [
      { label: 'スマートフォン', value: 78, color: 'bg-secondary' },
      { label: 'PC', value: 18, color: 'bg-primary' },
      { label: 'タブレット', value: 4, color: 'bg-tertiary' },
    ],
  },
  {
    icon: 'conversion_path',
    title: 'コンバージョン考察',
    subtitle: '成果に繋がったキーワードとクリエイティブの分析',
    table: [
      { name: 'リターゲティング_秋CP', cv: 124, cvr: '3.2%', cpa: '¥1,200' },
      { name: '新規獲得_ディスプレイ', cv: 58, cvr: '1.1%', cpa: '¥2,450' },
    ],
  },
  {
    icon: 'attach_money',
    title: 'ROI・費用対効果',
    subtitle: '投資に対する利益率の算出と将来予測',
  },
]

function normalizeSections(rawSections) {
  const sections = Array.isArray(rawSections) ? rawSections : []

  return [
    {
      ...FALLBACK_SECTIONS[0],
      ...sections[0],
      metrics:
        Array.isArray(sections[0]?.metrics) && sections[0].metrics.length > 0
          ? sections[0].metrics
          : FALLBACK_SECTIONS[0].metrics,
    },
    {
      ...FALLBACK_SECTIONS[1],
      ...sections[1],
      devices:
        Array.isArray(sections[1]?.devices) && sections[1].devices.length > 0
          ? sections[1].devices
          : FALLBACK_SECTIONS[1].devices,
    },
    {
      ...FALLBACK_SECTIONS[2],
      ...sections[2],
      table:
        Array.isArray(sections[2]?.table) && sections[2].table.length > 0
          ? sections[2].table
          : FALLBACK_SECTIONS[2].table,
    },
    {
      ...FALLBACK_SECTIONS[3],
      ...sections[3],
    },
  ]
}

const report = insights?.report ?? insights?.analysis ?? insights?.content ?? null
const displaySections = normalizeSections(insights?.sections)
```

#### 補足

- これなら API がタイトルや本文だけ返した場合も描画を継続できる
- 将来 `sections[0].title` などが返るようになっても自然に上書きされる
- `AnalysisGraphs.jsx` の「フォールバックを持つ」設計には合わせつつ、今回必要な形状保証も追加できる

### 2. `src/api/marketLens.js` に HTTP ステータスを保持させる

#### 方針

Dashboard だけで文字列判定するのではなく、API クライアントで `Error` に `status` を載せる。

#### 実装イメージ

```javascript
if (!res.ok) {
  const body = await res.json().catch(() => ({}))
  const error = new Error(body.detail || `Market Lens API error: ${res.status}`)
  error.status = res.status
  error.body = body
  throw error
}
```

#### 理由

- 404 判定がメッセージ文言に依存しない
- `Dashboard.jsx` 以外でも再利用できる
- 「変更しないファイル」にするより、ここで責務を整理した方が安全

### 3. `src/pages/Dashboard.jsx` で 404 のみ空状態へフォールバックする

#### 方針

`catch` で `e.status === 404` のときだけ履歴なしとして扱い、それ以外は既存どおりエラー表示する。

#### 実装イメージ

```javascript
.catch((e) => {
  if (e.status === 404) {
    setHistory([])
    setHistoryError(null)
    return
  }

  setHistoryError(e.message)
})
```

#### 意図

- バックエンド未実装環境では赤バナーではなく空状態 UI を見せる
- 真の障害は従来どおり検知できる

## 変更ファイル

| ファイル | 変更内容 |
|---------|---------|
| `src/pages/EssentialPack.jsx` | `FALLBACK_SECTIONS` 追加、`normalizeSections()` 追加、描画参照先を `displaySections` に変更 |
| `src/api/marketLens.js` | `request()` が投げる `Error` に `status` / `body` を付与 |
| `src/pages/Dashboard.jsx` | 404 のみ空状態扱い、それ以外はエラー表示を維持 |

## 変更しないファイル

- `src/api/adsInsights.js` - 今回の問題は `generateInsights()` 呼び出し自体ではなく描画側の防御不足
- `src/contexts/AuthContext.jsx` - 認証状態管理は今回の不具合に無関係
- `src/components/Layout.jsx` - レイアウト層に今回の原因はない

## 検証方法

1. `npm run dev` でローカル起動
2. 要点パック画面を開く
3. API 未実行状態でも画面が落ちず、フォールバックセクションが描画されることを確認する
4. 「AI考察を生成」実行後、`report` のみ返るケースでもページが落ちないことを確認する
5. `sections` が一部欠けたレスポンスでも `metrics` / `devices` / `table` が安全にフォールバックされることを確認する
6. ダッシュボードで `/api/ml/history` が 404 の環境では赤バナーではなく「分析履歴がまだありません」が表示されることを確認する
7. 404 以外の障害では従来どおりエラーバナーが表示されることを確認する
8. `npm run build` が成功することを確認する

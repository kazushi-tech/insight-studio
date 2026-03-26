# Insight Studio

Market Lens AI と考察スタジオ(ads-insights)を統合した広告運用・競合分析SaaSダッシュボード（PC専用）。

## 技術スタック

| レイヤー | 技術 |
|----------|------|
| Frontend | Vite + React + Tailwind CSS v4 |
| Routing | React Router |
| Font | Manrope + Material Symbols Outlined |
| Deploy | Vercel |
| Design | Stitch 2.0 エクスポート準拠 |

## アーキテクチャ

フロントエンドのみの新規リポ。バックエンドは既存サービスをAPIプロキシ経由で呼び出す。

```
Insight Studio (このリポ / Vercel)
├── /api/ml/*   → Market Lens API (market-lens-ai.vercel.app)
└── /api/ads/*  → 考察スタジオ API (ads-insights-9q5s.onrender.com)
```

## ディレクトリ構成

```
src/
  components/   共通コンポーネント（Layout等）
  pages/        各画面コンポーネント
  index.css     Tailwind v4 テーマ定義
  App.jsx       ルーティング
  main.jsx      エントリポイント
vercel.json     APIプロキシ rewrites
```

## 標準コマンド

```bash
npm install          # 依存インストール
npm run dev          # 開発サーバー（port 3002）
npm run build        # プロダクションビルド
```

## デザインシステム

- **配色:** Deep Navy (#1A1A2E) + Muted Gold (#D4A843) アクセント、白背景ベース
- **フォント:** Manrope（日英対応）
- **カード:** border-radius 16px、ボーダーなし、トーナルレイヤリング
- **ボタン:** border-radius 12px、ゴールドアクセント
- **モード:** ライトモードデフォルト

## 統合元サービス

| サービス | リポ | バックエンドURL |
|----------|------|---------------|
| Market Lens AI | market-lens-ai | market-lens-ai.vercel.app |
| 考察スタジオ | ads-insights | ads-insights-9q5s.onrender.com |

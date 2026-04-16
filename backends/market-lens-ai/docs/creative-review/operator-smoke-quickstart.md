# Creative Review — Operator Smoke Quickstart

このメモは、Browser UI 12 項目の smoke test を実行するためのクイックガイド。

**推奨: 自動実行 (Playwright)**

Browser UI smoke は Playwright 自動化に移行済み。手動実行は不要。

```powershell
# PowerShell Terminal 1: backend
$env:SMOKE_MODE = '1'
.\.venv\Scripts\python.exe -m uvicorn web.app.main:app --host 127.0.0.1 --port 8002

# PowerShell Terminal 2: frontend
npm run dev

# PowerShell Terminal 3: automation
$env:SMOKE_MODE = '1'
$env:PYTHONIOENCODING = 'utf-8'
.\.venv\Scripts\python.exe scripts/run_browser_smoke.py
```

結果:

1. latest artifacts は `tmp_review_assets/smoke_summary.json` と `tmp_review_assets/smoke_screenshots/`
2. run ごとの完全な証跡は `tmp_review_assets/smoke_runs/<run_id>/`

---

## 手動実行 (fallback)

自動化がうまくいかない場合のみ、以下の手動手順を使う。

対象:

1. Browser UI 12 項目
2. `SH-1〜SH-4`
3. `CR-1〜CR-8`

`CR-9` は WeasyPrint 環境がある場合のみの supplemental check。

---

## 0. 先にやること

1. `config/domain_allowlist.example.json` を `config/domain_allowlist.json` にコピーする
2. scan / LP review で使うドメインを `config/domain_allowlist.json` に入れる
3. PowerShell で repo root から `.\scripts\boot.ps1` を実行する
4. ブラウザで `http://localhost:3001` を開く

起動後に見る場所:

1. メイン UI: `http://localhost:3001`
2. backend health: `http://localhost:8002/api/health`

---

## 1. SH-1: スキャン実行

1. 上部タブで `スキャン` を開く
2. `比較対象の URL を入力` の 1 行目に allowlist 済み URL を 1 つ入れる
3. 必要なら `Gemini API Key` を入れる
4. `分析を開始` を押す
5. 下にレポートが表示されれば PASS

FAIL の目印:

1. `Domain ... is not in the allowlist`
2. `Rate limit exceeded`
3. `Internal server error`

---

## 2. SH-2: 履歴一覧

1. 上部タブで `履歴` を開く
2. さっき実行した scan が一覧に 1 件以上見えれば PASS
3. 何もない場合は `SH-1` が失敗している

---

## 3. SH-3: 履歴詳細と削除

1. `履歴` 一覧の行をクリックする
2. 詳細画面に切り替わり、本文が見えれば PASS の前半
3. `← 一覧へ戻る` で戻れることを確認する
4. もう一度一覧の `削除` を押す
5. 確認ダイアログで OK して一覧から消えれば PASS の後半

---

## 4. SH-4: テーマ切替

1. 右上の丸いテーマボタンを押す
2. 明るい配色から暗い配色へ切り替われば PASS
3. もう一度押して元に戻ることも確認する

---

## 5. CR-1: レビュータブ表示

1. 上部タブで `レビュー` を開く
2. `クリエイティブレビュー` カードが見えれば PASS

---

## 6. CR-2 / CR-3 / CR-4: アップロード

使うもの:

1. PNG / JPG / GIF / WebP
2. 10MB 以下の画像 1 枚

確認手順:

1. 画像をドラッグして upload zone に落とす
2. 画像プレビューが出れば `CR-2` PASS
3. もう一度ページを開き直すか、別画像で upload zone をクリックする
4. ファイル選択ダイアログが開けば `CR-3` PASS
5. アップロード完了後、ステータス欄に `アップロード完了: ... (asset_id)` が出れば `CR-4` PASS

---

## 7. CR-5: バナーレビュー

1. `LP URL` は空のままにする
2. 必要なら `ブランド情報` に短い文字列を入れる
3. 必要なら `運用者メモ` を入れる
4. `レビューを実行` を押す
5. `レビューが完了しました` が出て、下に `レビュー結果` カードが出れば PASS

---

## 8. CR-6 / CR-7: ad-to-LP review と表示内容

1. `LP URL` に allowlist 済み URL を入れる
2. `レビューを実行` を押す
3. 成功すれば `CR-6` PASS
4. 結果カードに次の 5 セクションが見えれば `CR-7` PASS

確認する見出し:

1. `良い点`
2. `守るべき点`
3. `改善提案`
4. `次に試すテスト案`
5. `根拠・出典`

---

## 9. CR-8: HTML One-Pager

1. レビュー結果が表示された状態で `HTML One-Pager` を押す
2. `creative-review-onepager.html` が落ちれば PASS
3. その HTML をブラウザで開いて内容が見えればより確実

---

## 10. CR-9: PDF ダウンロード

これは WeasyPrint が入っている環境だけで確認する supplemental check。

1. `PDF ダウンロード` を押す
2. PDF が落ちて開ければ PASS
3. WeasyPrint がない環境では browser check ではなく supplemental 扱い

---

## 11. 記録のしかた

各項目について checklist に次を埋める:

1. `Date`
2. `Operator`
3. `Result`
4. `Notes`

`Result` の目安:

1. `PASS` = 期待どおり動いた
2. `FAIL` = 動かなかった / エラーになった
3. `BLOCKED` = 環境条件がなく確認できなかった

---

## 12. FAIL したときに最低限取るもの

1. スクリーンショット 1 枚
2. DevTools Console の赤いエラー
3. DevTools Network の失敗リクエスト
4. `boot.ps1` を動かしているターミナルの backend log

保存先の目安:

1. `tmp_review_assets/SH-1_YYYY-MM-DD.png`
2. `tmp_review_assets/SH-1_console.txt`
3. `tmp_review_assets/SH-1_network.txt`
4. `tmp_review_assets/SH-1_backend.txt`

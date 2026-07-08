# Fix: Discovery Sonnet 分析タイムアウト — 真の原因特定と修正

## Context

Discovery が Sonnet で150秒タイムアウトする問題を修正中。前回の対応で Haiku へのモデル変更を含む commit (b8b1273) を push 済みだが、**ユーザーの要件は Sonnet 維持**。

### 前回のテストが無効だった理由
テスト中、**旧サーバープロセスがポート8002を占有し続けていた**（ログで確認済み）。つまりプロンプト最適化・パイプライン軽量化の効果を **Sonnet では一度も正しくテストできていなかった**。Haiku テスト（v10）のみが新サーバーで実行された。

### 修正済みの最適化（維持する）
これらは既に commit 済みで、効果をSonnetで検証する必要がある:
- プロンプト縮小: 10→4注意事項、5→4セクション、価格戦略/モバイル最適化/コンバージョン設計分析を削除
- 入力データ縮小: body 800→400, features 5→3, FAQ 3→2, testimonials 2→1
- max_output_tokens: 5120→3072（単体）、12288→4096（比較）
- 検索: num 12→7、2つ目クエリ無効化
- MAX_COMPETITORS: 4→2
- LLMバリデーション無効化

### 期待される所要時間（最適化後 + Sonnet）
| ステージ | Before最適化 | After最適化（予測） |
|----------|-------------|-------------------|
| classify | ~4s | ~4s |
| search | ~43s | ~18-25s（num=7、単一クエリ） |
| fetch | ~8s | ~3-8s（2社のみ） |
| analyze | ~100s+（タイムアウト） | ~50-80s（縮小プロンプト+4096トークン） |
| **合計** | **150s+（失敗）** | **~75-117s（150s以内）** |

## 変更内容

### Step 1: Haiku → Sonnet に戻す（1ファイル）

**`web/app/services/discovery/discovery_pipeline.py`** (line 555-559)

```python
# 現在（Haiku）
discovery_analysis_model = (
    os.getenv("ANTHROPIC_DISCOVERY_ANALYSIS_MODEL")
    or req.model
    or "claude-haiku-4-5-20251001"
)

# 修正後（Sonnet — コードベース全体のデフォルトと一致）
discovery_analysis_model = (
    os.getenv("ANTHROPIC_DISCOVERY_ANALYSIS_MODEL")
    or req.model
)
```

`req.model` が None の場合、`call_anthropic()` → `candidate_anthropic_models(None)` → `normalize_anthropic_model(None)` → `_DEFAULT_ANTHROPIC_MODEL` = `"claude-sonnet-4-6"` が使われる。明示的にモデル名をハードコードする必要なし。

### Step 2: タイムアウトは変更しない
- overall_job_timeout: 150s（維持）
- analyze_timeout: 120s（維持）
- 最適化後の合計は75-117sの見積もり → 150s以内に収まるはず

## 検証手順

### 1. サーバープロセスの完全停止（確実に）
```bash
# netstat で8002ポートのPIDを全て特定
netstat -ano | findstr :8002
# 全PIDを taskkill /F /PID で強制終了
# ポートが完全に空いたことを curl で確認（応答なし = OK）
curl -s --connect-timeout 2 http://localhost:8002/api/health → 応答なしを確認
```

### 2. バックエンド＆フロントエンド起動
```bash
# Backend (port 8002)
cd "c:/Users/PEM N-266/work/market-lens-ai"
.venv/Scripts/python.exe -m uvicorn web.app.main:app --host 0.0.0.0 --port 8002

# Frontend (port 3002) — insight-studio
cd "c:/Users/PEM N-266/work/insight-studio"
npm run dev
```

### 3. Chrome DevTools で Discovery を実行（/devtools-verify skill 使用）
1. Chrome をゲストモードで起動（クリーンな localStorage）
2. `http://localhost:3002` を開く
3. DevTools > Network タブを開く
4. Discovery 画面に移動し、テスト用 URL（例: `https://proactiv.jp/`）を入力して実行
5. 以下を記録:
   - `/api/ml/discovery/jobs` POST のレスポンス（job_id取得）
   - ポーリング GET リクエストの各レスポンス（stage 遷移を確認）
   - 最終レスポンスの status（completed or failed）
   - Network タブで全体の所要時間
   - Console にエラーが出ていないか確認

### 4. バックエンドログで詳細確認
- `call_anthropic requested_model=None candidates=['claude-sonnet-4-6']` → Sonnet使用を確認
- `call_anthropic SUCCESS model=claude-sonnet-4-6 elapsed=XXs` → analyze時間を記録
- タイムアウトエラーが出ていないことを確認

### 5. Compare（scan）も DevTools で確認
1. Compare 画面に移動
2. テスト用 URL を2つ入力して実行
3. レスポンスが正常に返ることを確認
4. Network タブで所要時間を記録

### 6. 合否判定
- [ ] Discovery が Sonnet で150秒以内に完了する
- [ ] ログに `model=claude-sonnet-4-6` が表示される
- [ ] Compare も正常にレポート生成される
- [ ] Console にエラーなし
- [ ] レポート品質が「広告運用プロフェッショナル」レベルである

### 7. Sonnet でも遅い場合の段階的対応（タイムアウト変更なし）
1. max_output_tokens を 4096→3072 に下げる（比較モード）→ 再テスト
2. MAX_COMPETITORS を 2→1 に下げる → 再テスト
3. プロンプトをさらに縮小 → 再テスト
4. 各段階で DevTools で再検証し、効果を実測してから次のステップへ

## 変更対象ファイル

| ファイル | 変更内容 |
|---------|---------|
| `web/app/services/discovery/discovery_pipeline.py` | Haiku フォールバック削除 → Sonnet デフォルト使用 |

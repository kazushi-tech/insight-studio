# Creative Review Metadata Model

## Purpose

Pack B で DB へ移行できるよう、asset / review / export metadata の contract を固定する。
Pack A (Internal Alpha) は file-backed 実装で回し、Pack B で DB 差し替えを行う。

---

## Entity Definitions

### CreativeReviewRun

レビュー実行の単位。1 回の operator 操作 = 1 run。

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `run_id` | string (hex12) | yes | ユニーク ID |
| `review_type` | enum: `banner_review`, `ad_lp_review` | yes | レビュー種別 |
| `asset_id` | string (hex12) | yes | 対象 asset の ID |
| `lp_url` | string | ad_lp のみ | LP の URL |
| `status` | enum: `pending`, `running`, `completed`, `failed` | yes | 実行状態 |
| `operator_memo` | string | no | 運用者メモ |
| `brand_info` | string | no | ブランド情報 |
| `created_at` | datetime (UTC) | yes | 作成日時 |
| `completed_at` | datetime (UTC) | no | 完了日時 |

### ReviewOutput

レビュー結果。`review-output.schema.json` に準拠。

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `run_id` | string (hex12) | yes | 所属する run の ID |
| `output_json` | object | yes | `review-output.schema.json` 準拠の JSON |
| `model_used` | string | no | 使用した AI モデル名 |
| `created_at` | datetime (UTC) | yes | 生成日時 |

### ExportRecord

エクスポート履歴。

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `export_id` | string (hex12) | yes | ユニーク ID |
| `run_id` | string (hex12) | yes | 所属する run の ID |
| `format` | enum: `html`, `pdf`, `pptx` | yes | 出力形式 |
| `file_path` | string | yes | 保存先パス (file) / オブジェクトキー (S3) |
| `file_size_bytes` | int | no | ファイルサイズ |
| `created_at` | datetime (UTC) | yes | 生成日時 |

---

## Relationships

```
CreativeReviewRun 1 --- 0..1 ReviewOutput
CreativeReviewRun 1 --- 0..* ExportRecord
CreativeReviewRun * --- 1   CreativeAsset (via asset_id)
```

---

## DB Migration Notes

Pack B で DB 実装に差し替える際の指針:

1. **Primary Key**: すべて `hex12` 文字列。DB では `VARCHAR(12)` または `CHAR(12)`。
2. **Timestamps**: `datetime (UTC)` → `TIMESTAMP WITH TIME ZONE`。
3. **JSON 列**: `ReviewOutput.output_json` → `JSONB` (PostgreSQL)。
4. **Indexes**: `run_id` は各テーブルの FK。`created_at` に降順 index 推奨。
5. **Repository Interface**: `CreativeReviewRepository` の abstract methods はそのまま DB 実装に差し替え可能。
6. **Binary Assets**: file → S3/GCS object storage。`file_path` は object key に変わる。
7. **Tenant Isolation**: Pack C で `workspace_id` カラムを追加し、全クエリに tenant filter を入れる。

---

## File-Backed Layout (Pack A)

```
data/creative_reviews/
  <run_id>/
    run.json          # CreativeReviewRun metadata
    output.json       # ReviewOutput (review-output.schema.json)
    exports/
      <export_id>.html
      <export_id>.pdf
      <export_id>.pptx
```

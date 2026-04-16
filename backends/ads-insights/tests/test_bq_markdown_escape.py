"""BQ reporter Markdown エスケープのテスト

`page_title` や `source/medium` に `|` を含む値が
Markdown テーブルの列区切りとして誤解釈されないことを検証する。
"""

import sys
from pathlib import Path

# プロジェクトルートを sys.path に追加
_PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_PROJECT_ROOT))

import pandas as pd
from bq.reporter import _escape_markdown_cell, _escape_df_for_markdown, _summarize


# ---------------------------------------------------------------------------
# _escape_markdown_cell 単体テスト
# ---------------------------------------------------------------------------

def test_escape_pipe_in_string():
    assert _escape_markdown_cell("会社概要 | ペタビット株式会社") == "会社概要 \\| ペタビット株式会社"


def test_escape_no_pipe():
    assert _escape_markdown_cell("トップページ") == "トップページ"


def test_escape_none():
    assert _escape_markdown_cell(None) == ""


def test_escape_nan():
    assert _escape_markdown_cell(float("nan")) == ""


def test_escape_numeric():
    assert _escape_markdown_cell(12345) == "12345"
    assert _escape_markdown_cell(3.14) == "3.14"


def test_escape_multiple_pipes():
    assert _escape_markdown_cell("A | B | C") == "A \\| B \\| C"


# ---------------------------------------------------------------------------
# _escape_df_for_markdown テスト
# ---------------------------------------------------------------------------

def test_escape_df_preserves_numeric():
    df = pd.DataFrame({
        "page_title": ["会社概要 | ペタビット", "トップ"],
        "page_views": [100, 200],
        "sessions": [50, 80],
    })
    escaped = _escape_df_for_markdown(df)
    # 文字列列はエスケープ済み
    assert escaped["page_title"].iloc[0] == "会社概要 \\| ペタビット"
    # 数値列は変わらない
    assert escaped["page_views"].iloc[0] == 100
    assert escaped["sessions"].iloc[1] == 80
    # 元の DataFrame は変更されていない
    assert df["page_title"].iloc[0] == "会社概要 | ペタビット"


def test_escape_df_empty():
    df = pd.DataFrame(columns=["page_title", "page_views"])
    escaped = _escape_df_for_markdown(df)
    assert len(escaped) == 0


# ---------------------------------------------------------------------------
# _summarize テスト: pv クエリタイプで page_title に `|` が含まれるケース
# ---------------------------------------------------------------------------

def test_summarize_pv_pipe_in_page_title():
    """page_title に `|` を含む値が Markdown テーブルで列ずれしないことを検証。"""
    df = pd.DataFrame({
        "event_date": ["20260201"] * 3,
        "page_title": [
            "会社概要 | ペタビット株式会社",
            "トップページ",
            "サービス | 開発 | ペタビット",
        ],
        "page_views": [500, 300, 200],
        "sessions": [100, 80, 50],
        "users": [90, 70, 45],
    })
    md = _summarize(df, "pv", "2026-02")

    # `| ペタビット` がエスケープされていること
    assert "\\|" in md, f"パイプがエスケープされていない: {md}"

    # Markdown テーブル行を検証: page_views / sessions 列に文字列が混入しないこと
    for line in md.splitlines():
        if "会社概要" in line and "|" in line:
            cells = line.split("|")
            # to_markdown の出力は "| val1 | val2 | ... |" 形式
            # エスケープ済みの `\|` は split で壊れないことを確認
            # page_views は 500, sessions は 100 のはず
            cleaned = [c.strip() for c in cells if c.strip()]
            # 少なくとも数値が含まれているはず
            has_500 = any("500" in c for c in cleaned)
            assert has_500, f"page_views=500 が正しく表示されていない: {cleaned}"
            break


# ---------------------------------------------------------------------------
# _summarize テスト: traffic クエリタイプで source/medium に `|` が含まれるケース
# ---------------------------------------------------------------------------

def test_summarize_traffic_pipe_in_source():
    """source/medium に `|` を含む値が手組みテーブルで崩れないことを検証。"""
    df = pd.DataFrame({
        "source": ["google", "example|test", "direct"],
        "medium": ["organic", "referral", "(none)"],
        "sessions": [500, 200, 100],
        "users": [400, 150, 80],
        "page_views": [1000, 400, 200],
    })
    md = _summarize(df, "traffic", "2026-02")

    # `|` がエスケープされていること
    assert "example\\|test" in md or "example\\\\|test" in md, \
        f"source の `|` がエスケープされていない: {md}"


# ---------------------------------------------------------------------------
# _summarize テスト: landing クエリタイプで landing_page に `|` が含まれるケース
# ---------------------------------------------------------------------------

def test_summarize_landing_pipe_in_page():
    """landing_page に `|` を含む値が崩れないことを検証。"""
    df = pd.DataFrame({
        "landing_page": ["/about | company", "/", "/service"],
        "sessions": [300, 200, 100],
        "bounce_rate": [0.45, 0.50, 0.70],
        "avg_pages_per_session": [2.1, 1.8, 1.2],
    })
    md = _summarize(df, "landing", "2026-02")

    assert "\\|" in md, f"landing_page の `|` がエスケープされていない: {md}"


# ---------------------------------------------------------------------------
# メイン実行
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    tests = [
        test_escape_pipe_in_string,
        test_escape_no_pipe,
        test_escape_none,
        test_escape_nan,
        test_escape_numeric,
        test_escape_multiple_pipes,
        test_escape_df_preserves_numeric,
        test_escape_df_empty,
        test_summarize_pv_pipe_in_page_title,
        test_summarize_traffic_pipe_in_source,
        test_summarize_landing_pipe_in_page,
    ]
    passed = 0
    failed = 0
    for t in tests:
        try:
            t()
            print(f"  PASS {t.__name__}")
            passed += 1
        except Exception as e:
            print(f"  FAIL {t.__name__}: {e}")
            failed += 1
    print(f"\nResult: {passed} passed, {failed} failed")
    if failed:
        sys.exit(1)

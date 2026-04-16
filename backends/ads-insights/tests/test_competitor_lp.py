"""competitor-lp-analyzer のユニットテスト"""

import sys
from pathlib import Path

# パス設定
_PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_PROJECT_ROOT))
_SKILLS_DIR = _PROJECT_ROOT / ".agent" / "skills"
sys.path.insert(0, str(_SKILLS_DIR))
sys.path.insert(0, str(_SKILLS_DIR / "competitor-lp-analyzer"))

# テスト対象モジュール
import importlib.util
spec = importlib.util.spec_from_file_location(
    "lp_analyze", _SKILLS_DIR / "competitor-lp-analyzer" / "analyze.py"
)
analyze_mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(analyze_mod)


# テスト用HTML
SAMPLE_HTML = """
<!DOCTYPE html>
<html lang="ja">
<head>
    <title>テスト商品 | 最安値で購入</title>
    <meta name="description" content="テスト商品を最安値で購入できます。送料無料。">
</head>
<body>
    <div class="hero">
        <h1>テスト商品で生活を変えよう</h1>
        <button>今すぐ購入</button>
    </div>
    <section class="features">
        <h2>3つの特徴</h2>
        <h3>特徴1: 高品質</h3>
        <h3>特徴2: 低価格</h3>
        <h3>特徴3: 即日配送</h3>
        <img src="feature1.jpg" alt="特徴1">
        <img src="feature2.jpg" alt="特徴2">
    </section>
    <section class="testimonial">
        <h2>お客様の声</h2>
    </section>
    <form action="/contact">
        <input type="text" name="name" placeholder="名前">
        <input type="email" name="email" placeholder="メール">
        <textarea name="message"></textarea>
        <input type="submit" value="送信する">
    </form>
    <div class="cta">
        <a href="/buy" class="btn-primary">購入ページへ</a>
    </div>
</body>
</html>
"""

MINIMAL_HTML = """
<!DOCTYPE html>
<html><head><title>シンプルページ</title></head>
<body><p>テキストのみ</p></body>
</html>
"""


def test_extract_lp_structure_title():
    """タイトル抽出テスト。"""
    result = analyze_mod.extract_lp_structure(SAMPLE_HTML, "https://example.com")

    assert result["title"] == "テスト商品 | 最安値で購入"
    print("  [PASS] タイトル抽出")


def test_extract_lp_structure_meta():
    """メタディスクリプション抽出テスト。"""
    result = analyze_mod.extract_lp_structure(SAMPLE_HTML, "https://example.com")

    assert "最安値" in result["meta_description"]
    assert "送料無料" in result["meta_description"]
    print("  [PASS] メタディスクリプション抽出")


def test_extract_lp_structure_headings():
    """見出し抽出テスト。"""
    result = analyze_mod.extract_lp_structure(SAMPLE_HTML, "https://example.com")

    assert len(result["headings"]["h1"]) == 1
    assert "テスト商品" in result["headings"]["h1"][0]
    assert len(result["headings"]["h2"]) == 2  # 3つの特徴 + お客様の声
    assert len(result["headings"]["h3"]) == 3  # 特徴1, 2, 3
    print("  [PASS] 見出し抽出: h1=1, h2=2, h3=3")


def test_extract_lp_structure_ctas():
    """CTA抽出テスト。"""
    result = analyze_mod.extract_lp_structure(SAMPLE_HTML, "https://example.com")

    assert result["cta_count"] >= 2  # button + a.btn + submit
    cta_texts = [c["text"] for c in result["ctas"]]
    assert any("購入" in t for t in cta_texts)
    print(f"  [PASS] CTA抽出: {result['cta_count']}個")


def test_extract_lp_structure_forms():
    """フォーム抽出テスト。"""
    result = analyze_mod.extract_lp_structure(SAMPLE_HTML, "https://example.com")

    assert result["forms"] == 1
    assert result["form_fields"] >= 3  # name, email, message, submit
    print(f"  [PASS] フォーム抽出: {result['forms']}個, フィールド{result['form_fields']}個")


def test_extract_lp_structure_images():
    """画像数テスト。"""
    result = analyze_mod.extract_lp_structure(SAMPLE_HTML, "https://example.com")

    assert result["image_count"] == 2
    print("  [PASS] 画像数: 2枚")


def test_extract_lp_structure_word_count():
    """テキスト量テスト。"""
    result = analyze_mod.extract_lp_structure(SAMPLE_HTML, "https://example.com")

    assert result["word_count"] > 0
    print(f"  [PASS] テキスト量: {result['word_count']}文字")


def test_extract_lp_structure_minimal():
    """最小限HTMLテスト。"""
    result = analyze_mod.extract_lp_structure(MINIMAL_HTML, "https://example.com")

    assert result["title"] == "シンプルページ"
    assert result["cta_count"] == 0
    assert result["forms"] == 0
    assert result["image_count"] == 0
    print("  [PASS] 最小限HTML: 正常解析")


def test_extract_lp_structure_empty():
    """空HTMLテスト。"""
    result = analyze_mod.extract_lp_structure("", "https://example.com")

    assert result["title"] == ""
    assert result["cta_count"] == 0
    print("  [PASS] 空HTML: エラーなし")


def test_validate_url():
    """URLバリデーションテスト。"""
    assert analyze_mod.validate_url("https://example.com") is True
    assert analyze_mod.validate_url("http://example.com/page") is True
    assert analyze_mod.validate_url("ftp://example.com") is False
    assert analyze_mod.validate_url("not-a-url") is False
    assert analyze_mod.validate_url("") is False
    print("  [PASS] URLバリデーション")


def test_url_field_in_structure():
    """URLフィールドがstructureに含まれることを確認。"""
    result = analyze_mod.extract_lp_structure(SAMPLE_HTML, "https://example.com/lp")

    assert result["url"] == "https://example.com/lp"
    print("  [PASS] URLフィールド保持")


def test_sections_detection():
    """セクション検出テスト。"""
    result = analyze_mod.extract_lp_structure(SAMPLE_HTML, "https://example.com")

    # hero, features, testimonial, cta セクションが検出されるはず
    assert len(result["sections"]) > 0
    print(f"  [PASS] セクション検出: {len(result['sections'])}個")


if __name__ == "__main__":
    print("=" * 50)
    print("  competitor-lp-analyzer テスト")
    print("=" * 50)

    tests = [
        test_extract_lp_structure_title,
        test_extract_lp_structure_meta,
        test_extract_lp_structure_headings,
        test_extract_lp_structure_ctas,
        test_extract_lp_structure_forms,
        test_extract_lp_structure_images,
        test_extract_lp_structure_word_count,
        test_extract_lp_structure_minimal,
        test_extract_lp_structure_empty,
        test_validate_url,
        test_url_field_in_structure,
        test_sections_detection,
    ]

    passed = 0
    failed = 0
    for test in tests:
        try:
            test()
            passed += 1
        except Exception as e:
            print(f"  [FAIL] {test.__name__}: {e}")
            failed += 1

    print(f"\n結果: {passed} passed, {failed} failed / {len(tests)} total")
    sys.exit(1 if failed > 0 else 0)

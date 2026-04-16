from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Optional, Tuple


KPI_ALIASES: Dict[str, List[str]] = {
    "cost": ["費用", "広告費", "コスト", "ご利用金額", "ご利用額", "利用金額", "利用額"],
    "impr": ["表示回数", "インプレッション", "imp", "impressions", "表示"],
    "clicks": ["クリック", "クリック数", "clicks"],
    "cv": ["cv", "コンバージョン", "コンバージョン数", "conversions", "お問合せ", "お問い合わせ", "問合せ"],
    "ctr": ["ctr", "クリック率"],
    "cvr": ["cvr", "コンバージョン率"],
    "cpc": ["cpc", "クリック単価"],
    "cpa": ["cpa", "獲得単価", "cv単価", "コンバージョン単価"],
}

CURRENT_ALIASES = ["current", "当月", "今月", "今期", "当期", "当月値", "今月値"]
BASE_ALIASES = ["base", "前月", "先月", "比較", "前月値", "先月値"]

MISSING_TOKENS = {"", "-", "—", "–", "未取得", "不明", "算出不可", "n/a", "na", "nan", "none", "null"}


def _strip_md(s: str) -> str:
    if s is None:
        return ""
    s = s.strip()
    s = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", s)
    s = re.sub(r"\[\[([^|\]]+)\|([^\]]+)\]\]", r"\2", s)
    s = re.sub(r"\[\[([^\]]+)\]\]", r"\1", s)
    s = s.replace("`", "")
    s = s.replace("*", "").replace("_", "")
    s = s.lstrip("\ufeff")
    return s.strip()


def _norm(s: str) -> str:
    s = _strip_md(s)
    s = s.strip().lower()
    s = s.replace("％", "%")
    s = re.sub(r"\s+", "", s)
    return s


def _is_separator_row(line: str) -> bool:
    t = line.strip().lstrip("\ufeff")
    if "|" not in t:
        return False
    cells = [c.strip() for c in t.strip("|").split("|")]
    if len(cells) < 2:
        return False
    for c in cells:
        if not re.fullmatch(r":?-{2,}:?", c):
            return False
    return True


def parse_md_tables(md_text: str) -> List[Dict[str, Any]]:
    md_text = md_text.lstrip("\ufeff")
    lines = md_text.splitlines()
    tables: List[Dict[str, Any]] = []
    i = 0
    while i < len(lines) - 1:
        line = lines[i].lstrip("\ufeff")
        if line.strip().startswith("|") and "|" in line:
            header_line = line
            sep_line = lines[i + 1] if i + 1 < len(lines) else ""
            if _is_separator_row(sep_line):
                start = i
                j = i + 2
                body_lines = []
                while j < len(lines):
                    cur = lines[j].lstrip("\ufeff")
                    if not (cur.strip().startswith("|") and "|" in cur):
                        break
                    body_lines.append(cur)
                    j += 1

                header = [_strip_md(c) for c in header_line.strip().strip("|").split("|")]
                rows = []
                for bl in body_lines:
                    cells = [_strip_md(c) for c in bl.strip().strip("|").split("|")]
                    if len(cells) < len(header):
                        cells += [""] * (len(header) - len(cells))
                    if len(cells) > len(header):
                        cells = cells[: len(header)]
                    rows.append(cells)

                raw = "\n".join(lines[start:j])
                tables.append(
                    {"header": header, "rows": rows, "start_line": start + 1, "end_line": j, "raw": raw}
                )
                i = j
                continue
        i += 1
    return tables


def _detect_kpi_key(label: str) -> Optional[str]:
    n = _norm(label)
    if not n:
        return None
    for key, aliases in KPI_ALIASES.items():
        for a in aliases:
            if _norm(a) == n:
                return key
    for key, aliases in KPI_ALIASES.items():
        for a in aliases:
            an = _norm(a)
            if an and (an in n or n in an):
                return key
    return None


def _guess_month_header_index(header: List[str]) -> Optional[Tuple[int, int]]:
    tokens = [_norm(h) for h in header]
    month_like = []
    for idx, t in enumerate(tokens):
        if re.search(r"\d{4}[-/]\d{1,2}", t) or re.search(r"\d{1,2}月", t):
            month_like.append(idx)
    if len(month_like) >= 2:
        return month_like[0], month_like[1]
    return None


def _pick_col(header: List[str], aliases: List[str]) -> Optional[int]:
    tokens = [_norm(h) for h in header]
    for i, t in enumerate(tokens):
        for a in aliases:
            if _norm(a) == t:
                return i
    for i, t in enumerate(tokens):
        for a in aliases:
            an = _norm(a)
            if an and an in t:
                return i
    return None


def _parse_number(raw: str) -> Optional[float]:
    s = _strip_md(raw).strip()
    if _norm(s) in {_norm(x) for x in MISSING_TOKENS}:
        return None

    s = s.replace(",", "")
    s = s.replace("円", "").replace("¥", "").replace("￥", "")
    s = s.replace("回", "").replace("件", "")
    s = s.replace("％", "%")

    is_percent = "%" in s
    s = s.replace("%", "").strip()
    if not s:
        return None

    s = s.replace("（", "(").replace("）", ")")
    if re.fullmatch(r"\(\s*-?\d+(\.\d+)?\s*\)", s):
        s = "-" + s.strip("() ").strip()

    m = re.search(r"-?\d+(?:\.\d+)?", s)
    if not m:
        return None
    val = float(m.group(0))
    return val


def _score_table_as_kpi(table: Dict[str, Any]) -> int:
    header = table["header"]
    rows = table["rows"]
    tokens = [_norm(h) for h in header]
    score = 0

    if any(t == "kpi" or t in ("指標", "項目") or "kpi" in t for t in tokens):
        score += 3
    if _pick_col(header, CURRENT_ALIASES) is not None:
        score += 2
    if _pick_col(header, BASE_ALIASES) is not None:
        score += 2
    if _guess_month_header_index(header) is not None:
        score += 1

    for r in rows[:10]:
        k = _detect_kpi_key(r[0]) if r else None
        if k:
            score += 1

    return score


def find_best_kpi_table(tables: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not tables:
        return None
    scored = [(t, _score_table_as_kpi(t)) for t in tables]
    scored.sort(key=lambda x: x[1], reverse=True)
    best, sc = scored[0]
    return None if sc < 2 else best


def _extract_kpis_by_regex(md_text: str) -> Dict[str, Dict[str, Any]]:
    out: Dict[str, Dict[str, Any]] = {}
    alias_map = {}
    for k, aliases in KPI_ALIASES.items():
        for a in aliases:
            alias_map[_norm(a)] = k

    pat = re.compile(r"^[\s>*\-•・]*([A-Za-z]{2,6}|[^\s:：]{1,12})\s*[:：]\s*(.+?)\s*$", re.M)
    for m in pat.finditer(md_text):
        label = _strip_md(m.group(1))
        val_raw = _strip_md(m.group(2))
        key = alias_map.get(_norm(label)) or _detect_kpi_key(label)
        if not key:
            continue
        out[key] = {
            "label": label,
            "current_raw": val_raw,
            "base_raw": "",
            "current": _parse_number(val_raw),
            "base": None,
        }
    return out


def extract_compare_kpis(md_text: str) -> Tuple[Dict[str, Dict[str, Any]], Dict[str, Any]]:
    md_text = md_text.lstrip("\ufeff")
    debug: Dict[str, Any] = {
        "reason": "",
        "tables_overview": [],
        "selected_table_header": None,
        "selected_table_range": None,
        "used_columns": None,
    }

    tables = parse_md_tables(md_text)
    debug["tables_overview"] = [
        {
            "range": f"L{t['start_line']}-L{t['end_line']}",
            "header": t["header"],
            "rows_preview": t["rows"][:2],
            "score": _score_table_as_kpi(t),
        }
        for t in tables
    ]

    best = find_best_kpi_table(tables)
    if not best:
        fallback = _extract_kpis_by_regex(md_text)
        if fallback:
            debug["reason"] = "KPIテーブルを特定できなかったため、キー:値の抽出にフォールバックしました。"
            return fallback, debug
        debug["reason"] = "KPIテーブルを特定できませんでした（テーブル形式/見出し/列名の揺れの可能性）。"
        return {}, debug

    header = best["header"]
    debug["selected_table_header"] = header
    debug["selected_table_range"] = f"L{best['start_line']}-L{best['end_line']}"

    kpi_col = _pick_col(header, ["kpi", "指標", "項目"]) or 0
    cur_col = _pick_col(header, CURRENT_ALIASES)
    base_col = _pick_col(header, BASE_ALIASES)

    if cur_col is None or base_col is None:
        month_guess = _guess_month_header_index(header)
        if month_guess and (cur_col is None or base_col is None):
            cur_col, base_col = month_guess

    if cur_col is None:
        cur_col = 1 if len(header) > 1 else 0
    if base_col is None:
        base_col = 2 if len(header) > 2 else (1 if len(header) > 1 else 0)

    debug["used_columns"] = {"kpi_col": kpi_col, "current_col": cur_col, "base_col": base_col}

    out: Dict[str, Dict[str, Any]] = {}
    for row in best["rows"]:
        if not row or kpi_col >= len(row):
            continue
        label = row[kpi_col]
        key = _detect_kpi_key(label)
        if not key:
            continue

        cur_raw = row[cur_col] if cur_col < len(row) else ""
        base_raw = row[base_col] if base_col < len(row) else ""

        out[key] = {
            "label": label,
            "current_raw": cur_raw,
            "base_raw": base_raw,
            "current": _parse_number(cur_raw),
            "base": _parse_number(base_raw),
        }

    if not out:
        debug["reason"] = "KPIテーブルは見つかりましたが、KPI名の表記ゆれで抽出できませんでした。"
        fallback = _extract_kpis_by_regex(md_text)
        if fallback:
            debug["reason"] += " 正規表現抽出にフォールバックしました。"
            return fallback, debug
        return {}, debug

    debug["reason"] = "OK"
    return out, debug


def _cli() -> int:
    import argparse
    from pathlib import Path

    ap = argparse.ArgumentParser()
    ap.add_argument("path")
    args = ap.parse_args()

    text = Path(args.path).read_text(encoding="utf-8-sig")
    kpis, dbg = extract_compare_kpis(text)
    print("=== KPIs ===")
    print(json.dumps(kpis, ensure_ascii=False, indent=2))
    print("\n=== DEBUG ===")
    print(json.dumps(dbg, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(_cli())

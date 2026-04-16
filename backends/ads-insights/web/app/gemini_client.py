from __future__ import annotations

import datetime as dt
import json
import os
import re
import time
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Set, Tuple


# Repo root: .../ads-insights/web/app/gemini_client.py -> parents[2] = repo root
REPO = Path(__file__).resolve().parents[2]
PROMPTS = REPO / "prompts"
LOG_DIR_DEFAULT = REPO / ".logs"

SYSTEM_PROMPT_PATH = PROMPTS / "insights_system.txt"
USER_TEMPLATE_PATH = PROMPTS / "insights_user_template.md"

DEFAULT_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
DEFAULT_TEMPERATURE = float(os.getenv("GEMINI_TEMPERATURE", "0.1"))
DEFAULT_MAX_OUTPUT_TOKENS = int(os.getenv("GEMINI_MAX_OUTPUT_TOKENS", "2048"))


# -----------------------------
# KPI vocabulary (canonical -> regex patterns)
# Only these are checked (so "フォーム流入" 等は対象外)
# -----------------------------
KPI_PATTERNS: Dict[str, List[re.Pattern]] = {
    "費用": [
        re.compile(r"(費用|広告費|コスト|ご利用金額|ご利用額)", re.IGNORECASE),
    ],
    "表示回数": [
        re.compile(r"(表示回数|インプレッション|imp(?:s)?\b)", re.IGNORECASE),
    ],
    "クリック": [
        re.compile(r"(クリック(数)?|click(?:s)?\b)", re.IGNORECASE),
    ],
    "CTR": [
        re.compile(r"\bCTR\b", re.IGNORECASE),
        re.compile(r"(クリック率)", re.IGNORECASE),
    ],
    "CPC": [
        re.compile(r"\bCPC\b", re.IGNORECASE),
        re.compile(r"(クリック単価)", re.IGNORECASE),
    ],
    "CV": [
        re.compile(r"\bCV\b", re.IGNORECASE),
        re.compile(r"(コンバージョン|コンバージョン数)", re.IGNORECASE),
    ],
    "CVR": [
        re.compile(r"\bCVR\b", re.IGNORECASE),
        re.compile(r"(コンバージョン率)", re.IGNORECASE),
    ],
    "CPA": [
        re.compile(r"\bCPA\b", re.IGNORECASE),
        re.compile(r"(獲得単価)", re.IGNORECASE),
    ],
    "CV値": [
        re.compile(r"\bCV値\b", re.IGNORECASE),
        re.compile(r"(コンバージョン値|コンバージョンの価値)", re.IGNORECASE),
    ],
    "売上": [
        re.compile(r"(売上|売上高|収益)", re.IGNORECASE),
        re.compile(r"\bRevenue\b", re.IGNORECASE),
    ],
    "売上単価": [
        re.compile(r"(売上単価|CV単価|平均売上)", re.IGNORECASE),
        re.compile(r"(単価/CV|売上/CV)", re.IGNORECASE),
    ],
    "ROAS": [
        re.compile(r"\bROAS\b", re.IGNORECASE),
        re.compile(r"(広告費用対効果|費用対効果)", re.IGNORECASE),
    ],
}

# number token (pretty broad, but we normalize heavily)
RE_NUM = re.compile(r"(?<![A-Za-z0-9_])[-+]?\d{1,3}(?:,\d{3})*(?:\.\d+)?%?(?![A-Za-z0-9_])")


@dataclass
class ValidationResult:
    ok: bool
    reasons: List[str]
    new_numbers: List[str]
    bad_kpis: List[str]


class InsightsValidationError(RuntimeError):
    pass


# -----------------------------
# Public entry points (keep them flexible for tools/web usage)
# -----------------------------
def generate_insights(
    point_pack_md: str,
    *,
    model: Optional[str] = None,
    temperature: Optional[float] = None,
    max_retries: int = 3,
    debug_name: Optional[str] = None,
    log_dir: Optional[Path] = None,
) -> str:
    """
    Generate insights markdown from point-pack markdown.

    Output contract:
      - Must begin with "## KPI比較（引用）" block (table quoted from point-pack)
      - Then "## TL;DR" ... (Gemini generates ONLY from TL;DR onward)
      - Must not introduce numbers not present in point-pack (existing gate)
      - Body must not mention KPI words that are NOT present in quoted KPI table
    """
    model = model or DEFAULT_MODEL
    temperature = DEFAULT_TEMPERATURE if temperature is None else float(temperature)
    log_dir = log_dir or LOG_DIR_DEFAULT
    log_dir.mkdir(parents=True, exist_ok=True)

    # STEP1: extract KPI table from point-pack
    kpi_table = extract_kpi_table(point_pack_md)
    kpi_quote_block = build_kpi_quote_block(kpi_table)

    allowed_kpis = extract_kpis_from_table(kpi_table)
    allowed_nums = extract_allowed_numbers(point_pack_md)

    # Prepare prompts (Gemini should output ONLY TL;DR onward)
    system_prompt = read_text(SYSTEM_PROMPT_PATH)
    user_template = read_text(USER_TEMPLATE_PATH)

    user_text_base = user_template.replace("{{POINT_PACK}}", point_pack_md)

    # Retry strategy (keep "new numbers zero" behavior intact / stronger)
    # try1: normal temp
    # try2: temp=0 + forbid lists
    # try3: temp=0 + forbid ANY half-width digits in body
    last_err: Optional[ValidationResult] = None

    for attempt in range(1, max_retries + 1):
        temp = 0.0 if attempt >= 2 else temperature

        extra_rules: List[str] = []

        # Always enforce: output starts at TL;DR, do not output KPI table
        extra_rules.append("出力は必ず `## TL;DR` から開始し、それ以前の文章や前置きは書かない。")
        extra_rules.append("`## KPI比較` の表や、それに類するMarkdown表は絶対に出力しない（表はコード側で付与する）。")

        # STEP2: KPI mention restriction
        if allowed_kpis:
            extra_rules.append(
                "本文（## TL;DR以降）で言及してよいKPIは、要点パックのKPI比較表に登場するものだけ。"
                f"今回の許可KPI: {', '.join(sorted(allowed_kpis))}。"
            )
        else:
            extra_rules.append("本文（## TL;DR以降）ではKPI（費用/表示回数/クリック/CTR/CPC/CV/CVR/CPA）に触れない。")

        # Existing strictness: no fabricated numbers (but allow calculated values)
        extra_rules.append(
            "要点パックに存在しない数値を新規に捏造しない。"
            "ただし、要点パックのKPI値から計算・導出した結果（例：前月比+200円、差分5%など）は言及してよい。"
        )
        extra_rules.append("不明な場合は『不明』『未取得』と書く（推測で数値を補完しない）。")

        # attempt>=2: give explicit feedback to rewrite
        if attempt >= 2 and last_err is not None:
            if last_err.new_numbers:
                extra_rules.append("前回の出力で『要点パックに無い数値』が混入した。以下の数値を本文から完全に除去して全文を書き直す: "
                                  + ", ".join(last_err.new_numbers[:30]))
            if last_err.bad_kpis:
                extra_rules.append("前回の出力で『許可されていないKPI』に言及した。以下のKPIに触れないよう全文を書き直す: "
                                  + ", ".join(sorted(set(last_err.bad_kpis))))

        # attempt==3: absolute digit ban (half-width) in body, like your existing "半角数字ゼロ" fallback
        if attempt >= 3:
            extra_rules.append("最終手段：本文（## TL;DR以降）では半角数字（0-9）を一切使わない。")

        extra_block = "\n".join([f"- {r}" for r in extra_rules])
        user_text = user_text_base.replace("{{EXTRA_RULES}}", extra_block)

        raw = call_gemini(system_prompt=system_prompt, user_text=user_text, model=model, temperature=temp)

        body = normalize_body_from_tldr(raw)
        final_md = (kpi_quote_block.rstrip() + "\n\n" + body.strip() + "\n")

        vr = validate_final_output(
            final_md=final_md,
            point_pack_md=point_pack_md,
            allowed_numbers=allowed_nums,
            allowed_kpis=allowed_kpis,
        )

        if vr.ok:
            return final_md

        last_err = vr
        save_debug(
            log_dir=log_dir,
            debug_name=debug_name or infer_debug_name(point_pack_md),
            attempt=attempt,
            model=model,
            temperature=temp,
            system_prompt=system_prompt,
            user_text=user_text,
            raw_output=raw,
            body_output=body,
            final_output=final_md,
            validation=vr,
        )

    raise InsightsValidationError(
        "insights generation failed after retries: "
        + (" / ".join(last_err.reasons) if last_err else "unknown")
    )



def generate_insights_from_point_pack(
    point_pack_md: str,
    *,
    model: Optional[str] = None,
    temperature: Optional[float] = None,
    max_retries: int = 3,
    debug_name: Optional[str] = None,
    log_dir: Optional[Path] = None,
) -> str:
    """
    Backward-compatible wrapper for older tools that import
    `generate_insights_from_point_pack`.
    """
    return generate_insights(
        point_pack_md,
        model=model,
        temperature=temperature,
        max_retries=max_retries,
        debug_name=debug_name,
        log_dir=log_dir,
    )
def generate_insights_from_file(
    point_pack_path: Path,
    *,
    out_path: Optional[Path] = None,
    model: Optional[str] = None,
    temperature: Optional[float] = None,
    max_retries: int = 3,
) -> str:
    md = read_text(point_pack_path)
    debug_name = point_pack_path.stem
    result = generate_insights(
        md,
        model=model,
        temperature=temperature,
        max_retries=max_retries,
        debug_name=debug_name,
    )
    if out_path is not None:
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(result, encoding="utf-8-sig")
    return result


# -----------------------------
# STEP1: KPI table extraction + quote block
# -----------------------------
def extract_kpi_table(point_pack_md: str) -> str:
    """
    Extract markdown table under:
      ## KPI比較（current vs 前月）
    Be tolerant to minor header variations.
    """
    # find the KPI section
    m = re.search(r"^##\s*KPI比較[^\n]*\n([\s\S]*?)(?=^##\s+|\Z)", point_pack_md, flags=re.MULTILINE)
    if not m:
        raise InsightsValidationError("KPI比較セクションが見つかりません（## KPI比較...）。")

    section = m.group(1)

    # find first markdown table in the section
    lines = section.splitlines()
    table_start = None
    for i, line in enumerate(lines):
        if "|" in line and re.search(r"\|", line):
            # header line likely
            # ensure separator follows within next 2 lines
            nxt = "\n".join(lines[i : i + 3])
            if re.search(r"^\s*\|?.+\|.+\|", line) and re.search(r"^\s*\|?\s*:?-{2,}", nxt, flags=re.MULTILINE):
                table_start = i
                break
    if table_start is None:
        # fallback: any contiguous lines containing pipes
        for i, line in enumerate(lines):
            if "|" in line:
                table_start = i
                break
    if table_start is None:
        raise InsightsValidationError("KPI比較セクション内にMarkdown表が見つかりません。")

    # capture contiguous table lines (pipes)
    table_lines: List[str] = []
    for j in range(table_start, len(lines)):
        if "|" not in lines[j]:
            if table_lines:
                break
            continue
        table_lines.append(lines[j].rstrip())
    table = "\n".join(table_lines).strip()

    # sanity: must include header separator row
    if not re.search(r"^-{2,}", table, flags=re.MULTILINE) and not re.search(r"\|?\s*:?-{2,}", table):
        # still allow, but warn by raising (better to fail early)
        raise InsightsValidationError("抽出したKPI表が表として不正っぽいです（セパレータ行が無い）。")

    return table


def build_kpi_quote_block(kpi_table_md: str) -> str:
    # NOTE: avoid digits here to not trigger number-gate
    return "## KPI比較（引用）\n\n" + kpi_table_md.strip() + "\n"


def extract_kpis_from_table(kpi_table_md: str) -> Set[str]:
    """
    Parse first column KPI labels and map to canonical KPIs defined in KPI_PATTERNS.
    """
    allowed: Set[str] = set()
    rows = [r.strip() for r in kpi_table_md.splitlines() if r.strip()]
    # Skip header(1) + separator(1)
    for row in rows[2:]:
        if "|" not in row:
            continue
        cols = [c.strip() for c in row.strip("|").split("|")]
        if not cols:
            continue
        label = cols[0]
        canon = canonical_kpi_from_text(label)
        if canon:
            allowed.add(canon)
    return allowed


def canonical_kpi_from_text(text: str) -> Optional[str]:
    for canon, pats in KPI_PATTERNS.items():
        for p in pats:
            if p.search(text):
                return canon
    return None


# -----------------------------
# STEP2: KPI mention detection (body only)
# -----------------------------
def detect_kpi_mentions(text: str) -> Set[str]:
    found: Set[str] = set()
    for canon, pats in KPI_PATTERNS.items():
        for p in pats:
            if p.search(text):
                found.add(canon)
                break
    return found


# -----------------------------
# Existing gate: "no new numbers"
# -----------------------------
def extract_allowed_numbers(point_pack_md: str) -> Set[str]:
    """
    Extract numeric tokens from point-pack and normalize to canonical numeric strings
    ignoring commas/percent/trailing zeros.
    """
    nums: Set[str] = set()
    for tok in RE_NUM.findall(point_pack_md):
        c = canon_number(tok)
        if c is not None:
            nums.add(c)
    return nums


def canon_number(tok: str) -> Optional[str]:
    t = tok.strip()
    if not t:
        return None
    # remove percent sign but keep numeric value only
    if t.endswith("%"):
        t = t[:-1]
    t = t.replace(",", "")
    # normalize unicode minus? (rare)
    t = t.replace("−", "-")
    try:
        d = Decimal(t)
    except (InvalidOperation, ValueError):
        return None
    # normalize trailing zeros
    s = format(d, "f")
    if "." in s:
        s = s.rstrip("0").rstrip(".")
    if s == "-0":
        s = "0"
    return s


def extract_numbers_from_text(text: str) -> List[str]:
    return RE_NUM.findall(text)


def validate_final_output(
    *,
    final_md: str,
    point_pack_md: str,
    allowed_numbers: Set[str],
    allowed_kpis: Set[str],
) -> ValidationResult:
    reasons: List[str] = []
    new_numbers: List[str] = []
    bad_kpis: List[str] = []

    # Must contain TL;DR section
    if "## TL;DR" not in final_md:
        reasons.append("`## TL;DR` が存在しません。")

    # Must start with KPI quote block
    if not final_md.lstrip().startswith("## KPI比較（引用）"):
        reasons.append("先頭に `## KPI比較（引用）` がありません。")

    # Must not contain KPI table headers generated by model
    if re.search(r"^##\s*KPI比較", final_md, flags=re.MULTILINE):
        # We allow only the fixed quote header (引用)
        # If model outputs another KPI比較 header, this triggers
        # (The quote header is "KPI比較（引用）" so it's okay)
        extra = [
            h for h in re.findall(r"^##\s*(KPI比較[^\n]*)", final_md, flags=re.MULTILINE)
            if "引用" not in h
        ]
        if extra:
            reasons.append("モデル出力が `## KPI比較...` を再掲しています（禁止）。")

    # KPI mention check (body only: from TL;DR)
    body = split_from_tldr(final_md)
    mentioned = detect_kpi_mentions(body)
    disallowed = sorted(list(mentioned - allowed_kpis)) if allowed_kpis else sorted(list(mentioned))
    if disallowed:
        bad_kpis = disallowed
        reasons.append("本文が『引用表に無いKPI』に言及しています: " + ", ".join(disallowed))

    # "no new numbers" check against point-pack numbers (canonical)
    # NOTE: we validate whole final_md; KPI quote table is from point-pack so it should pass
    for tok in extract_numbers_from_text(final_md):
        c = canon_number(tok)
        if c is None:
            continue
        if c not in allowed_numbers:
            new_numbers.append(tok)
    if new_numbers:
        # de-dup but keep original tokens
        uniq = []
        seen = set()
        for x in new_numbers:
            if x in seen:
                continue
            seen.add(x)
            uniq.append(x)
        new_numbers = uniq
        reasons.append("要点パックに存在しない数値が混入しています: " + ", ".join(new_numbers[:30]))

    ok = (len(reasons) == 0)
    return ValidationResult(ok=ok, reasons=reasons, new_numbers=new_numbers, bad_kpis=bad_kpis)


def split_from_tldr(md: str) -> str:
    m = re.search(r"^##\s*TL;DR[\s\S]*$", md, flags=re.MULTILINE)
    return m.group(0) if m else md


# -----------------------------
# Prompt / output handling
# -----------------------------
def read_text(path: Path) -> str:
    if not path.exists():
        raise FileNotFoundError(f"not found: {path}")
    # allow BOM
    return path.read_text(encoding="utf-8-sig")


def normalize_body_from_tldr(raw: str) -> str:
    """
    Force output to start at '## TL;DR' (strip any preamble).
    """
    raw = (raw or "").strip()
    # Find first TL;DR heading
    m = re.search(r"^##\s*TL;DR\b[\s\S]*$", raw, flags=re.MULTILINE)
    if m:
        body = m.group(0).strip()
    else:
        # If model forgot, prepend header and keep content (will fail validation -> retry)
        body = "## TL;DR\n\n" + raw
    return body


def infer_debug_name(point_pack_md: str) -> str:
    # Try to extract a title-ish line
    for line in point_pack_md.splitlines():
        s = line.strip()
        if s.startswith("#"):
            s = re.sub(r"^#+\s*", "", s)
            if s:
                return slugify(s)[:80]
    return "point_pack"


def slugify(s: str) -> str:
    s = s.strip()
    s = re.sub(r"\s+", "_", s)
    s = re.sub(r"[^\w\u3040-\u30ff\u4e00-\u9fff\-_]+", "", s)
    return s or "item"


def save_debug(
    *,
    log_dir: Path,
    debug_name: str,
    attempt: int,
    model: str,
    temperature: float,
    system_prompt: str,
    user_text: str,
    raw_output: str,
    body_output: str,
    final_output: str,
    validation: ValidationResult,
) -> None:
    ts = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
    name = slugify(debug_name)
    p = log_dir / f"insights_debug__{name}__try{attempt}__{ts}.json"
    data = {
        "attempt": attempt,
        "model": model,
        "temperature": temperature,
        "validation": {
            "ok": validation.ok,
            "reasons": validation.reasons,
            "new_numbers": validation.new_numbers,
            "bad_kpis": validation.bad_kpis,
        },
        "system_prompt": system_prompt,
        "user_text": user_text,
        "raw_output": raw_output,
        "body_output": body_output,
        "final_output": final_output,
    }
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")



def ensure_kpi_quote(point_pack_md: str, insights_md: str) -> str:
    """
    Offline-safe: rebuild insights so it ALWAYS starts with:
      ## KPI比較（引用）
      <table from point-pack>
    and then body from ## TL;DR onward (existing content reused, no API).
    """
    kpi_table = extract_kpi_table(point_pack_md)
    kpi_quote_block = build_kpi_quote_block(kpi_table).rstrip()
    body = normalize_body_from_tldr(insights_md).strip()
    return kpi_quote_block + "\n\n" + body + "\n"

# -----------------------------
# Gemini API call (supports google-genai OR google-generativeai)
# -----------------------------
def call_gemini(*, system_prompt: str, user_text: str, model: str, temperature: float) -> str:
    key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not key:
        raise RuntimeError("GEMINI_API_KEY または GOOGLE_API_KEY が未設定です。")

    # Prefer google-genai (new), fallback to google-generativeai (old)
    last_err: Optional[Exception] = None

    # 1) google-genai
    try:
        from google import genai  # type: ignore
        from google.genai import types  # type: ignore

        client = genai.Client(api_key=key)
        cfg = types.GenerateContentConfig(
            system_instruction=system_prompt,
            temperature=temperature,
            max_output_tokens=DEFAULT_MAX_OUTPUT_TOKENS,
        )
        resp = client.models.generate_content(
            model=model,
            contents=user_text,
            config=cfg,
        )
        txt = getattr(resp, "text", None)
        if txt:
            return txt
        # fallback: try to stitch parts
        cands = getattr(resp, "candidates", None)
        if cands:
            parts = []
            for c in cands:
                content = getattr(c, "content", None)
                if not content:
                    continue
                for part in getattr(content, "parts", []) or []:
                    t = getattr(part, "text", None)
                    if t:
                        parts.append(t)
            if parts:
                return "\n".join(parts)
        return str(resp)
    except Exception as e:
        last_err = e

    # 2) google-generativeai
    try:
        import google.generativeai as genai  # type: ignore

        genai.configure(api_key=key)
        # system_instruction is supported in recent versions; if not, we prepend to user_text
        try:
            mdl = genai.GenerativeModel(model_name=model, system_instruction=system_prompt)
            resp = mdl.generate_content(
                user_text,
                generation_config={"temperature": temperature, "max_output_tokens": DEFAULT_MAX_OUTPUT_TOKENS},
            )
        except TypeError:
            mdl = genai.GenerativeModel(model_name=model)
            combined = system_prompt.strip() + "\n\n" + user_text
            resp = mdl.generate_content(
                combined,
                generation_config={"temperature": temperature, "max_output_tokens": DEFAULT_MAX_OUTPUT_TOKENS},
            )

        txt = getattr(resp, "text", None)
        if txt:
            return txt
        # older responses might store in candidates
        cand = getattr(resp, "candidates", None)
        if cand:
            parts = []
            for c in cand:
                content = getattr(c, "content", None)
                if not content:
                    continue
                for part in getattr(content, "parts", []) or []:
                    t = getattr(part, "text", None)
                    if t:
                        parts.append(t)
            if parts:
                return "\n".join(parts)
        return str(resp)
    except Exception as e:
        if last_err is not None:
            raise RuntimeError(f"Gemini呼び出しに失敗しました（google-genai→google-generativeai）: {last_err} / {e}") from e
        raise


if __name__ == "__main__":
    # Minimal manual test:
    #   python web/app/gemini_client.py path/to/point-pack.md
    import sys

    if len(sys.argv) != 2:
        print("usage: python web/app/gemini_client.py <point-pack.md>", file=sys.stderr)
        raise SystemExit(2)

    pp = Path(sys.argv[1])
    out = generate_insights_from_file(pp)
    print(out)



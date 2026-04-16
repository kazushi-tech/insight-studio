from pathlib import Path
import re, sys

TARGET = Path("generate_reports.py")
s = TARGET.read_text(encoding="utf-8")

NEW_FUNC = r'''
def pick_month_tag(current_path, base_path=None):
    """
    Safer month_tag detector.
    - Prefer explicit: YYYY-MM / YYYY_MM / YYYY.MM / YYYY/MM
    - Accept compact: YYYYMM / YYYYMMDD
    - Allow Japanese separators like '年' '月' etc. BUT prevent false hits like '2025_ver2'
      by not allowing ASCII letters between year and month in loose mode.
    Debug:
      ADS_DEBUG_MONTH_TAG=1 prints match details to stderr
      ADS_MONTH_TAG=YYYY-MM forces the value (validated)
      ADS_STRICT_MONTH_TAG=1 raises if cannot detect
    """
    import os, re, sys
    from datetime import date
    from pathlib import Path

    debug = os.getenv("ADS_DEBUG_MONTH_TAG", "").strip() == "1"
    strict = os.getenv("ADS_STRICT_MONTH_TAG", "").strip() == "1"

    def _log(msg: str) -> None:
        if debug:
            print(f"[month_tag] {msg}", file=sys.stderr)

    override = os.getenv("ADS_MONTH_TAG", "").strip()
    if override:
        if re.fullmatch(r"20\\d{2}-(0[1-9]|1[0-2])", override):
            _log(f"override ADS_MONTH_TAG={override}")
            return override
        raise ValueError("ADS_MONTH_TAG must be YYYY-MM (e.g., 2025-12)")

    def _norm_digits(text: str) -> str:
        out = []
        for ch in text:
            o = ord(ch)
            if 0xFF10 <= o <= 0xFF19:
                out.append(chr(o - 0xFF10 + ord("0")))
            else:
                out.append(ch)
        return "".join(out)

    def _extract_from_name(name: str):
        name = _norm_digits(name)
        name = re.sub(r"\\s+", "", name)

        patterns = [
            ("ym_sep", re.compile(r"(?<!\\d)(20\\d{2})[._\\-/](0?[1-9]|1[0-2])(?!\\d)")),
            ("ymd_compact", re.compile(r"(?<!\\d)(20\\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\\d|3[01])(?!\\d)")),
            ("ym_compact", re.compile(r"(?<!\\d)(20\\d{2})(0[1-9]|1[0-2])(?!\\d)")),
            # loose-safe: between year and month allow up to 6 chars, but NOT digits and NOT ASCII letters
            ("ym_loose_safe", re.compile(r"(?<!\\d)(20\\d{2})(?:[^\\dA-Za-z]{0,6})(0?[1-9]|1[0-2])(?!\\d)")),
        ]

        for key, rx in patterns:
            m = rx.search(name)
            if m:
                y = int(m.group(1))
                mo = int(m.group(2))
                tag = f"{y:04d}-{mo:02d}"
                _log(f"match={key} name={name} -> {tag}")
                return tag
        _log(f"no_match name={name}")
        return None

    def _as_name(p):
        if not p:
            return None
        try:
            return Path(p).name
        except Exception:
            return str(p)

    for src, label in ((current_path, "current"), (base_path, "base")):
        n = _as_name(src)
        if not n:
            continue
        _log(f"name = {n}")
        tag = _extract_from_name(n)
        if tag:
            _log(f"use={label} tag={tag}")
            return tag

    today = date.today()
    tag = f"{today.year:04d}-{today.month:02d}"
    _log(f"fallback=today tag={tag}")
    if strict:
        raise ValueError("month_tag not detected from file names (strict mode enabled)")
    return tag
'''.strip("\\n") + "\\n\\n"

pat = re.compile(r"(?ms)^def pick_month_tag\\([\\s\\S]*?\\):\\n.*?(?=^(?:def|class)\\s+|\\Z)")
m = pat.search(s)
if not m:
    print("ERROR: pick_month_tag() not found. No changes made.", file=sys.stderr)
    sys.exit(1)

s2 = s[:m.start()] + NEW_FUNC + s[m.end():]
TARGET.write_text(s2, encoding="utf-8")
print("OK: patched pick_month_tag()")

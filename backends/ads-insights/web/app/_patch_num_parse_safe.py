from __future__ import annotations

import datetime as dt
import io
import re
import tokenize
from pathlib import Path

TARGETS = [
    Path("web/app/app.py"),
    Path("web/app/source_view.py"),
]

def backup(p: Path) -> Path:
    ts = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
    bak = p.with_name(p.name + f".bak.{ts}")
    bak.write_bytes(p.read_bytes())
    return bak

HELPER_MARK = "NUM_PARSE_SAFE_V1"
HELPER_BLOCK = r'''
# --- NUM_PARSE_SAFE_V1 ---
import re as _re

def _clean_num_str(x):
    # "141,383" / "¥141,383" / "141,383.88" を安全に数値化できる形へ
    if x is None:
        return x
    if isinstance(x, (int, float)):
        return x
    s = str(x)
    # 数字の桁区切りカンマだけ除去（"a,b" みたいなのは無視される）
    s = _re.sub(r"(?<=\d),(?=\d)", "", s)
    # 通貨記号や余計な空白の除去（必要最小限）
    s = s.replace("¥", "").replace(",", "").strip()
    return s

def _to_float(x):
    x = _clean_num_str(x)
    return float(x)

def _to_int(x):
    x = _clean_num_str(x)
    # "141383.0" みたいなのも吸収
    return int(float(x))
# --- /NUM_PARSE_SAFE_V1 ---
'''.lstrip("\n")

def replace_float_int_calls(code: str) -> tuple[str, int, int]:
    # tokenizeで “コード中の float()/int() 呼び出しだけ” を置換（文字列内は触らない）
    toks = list(tokenize.generate_tokens(io.StringIO(code).readline))
    out = []
    rep_float = 0
    rep_int = 0

    def prev_sig(i):
        j = i - 1
        while j >= 0 and toks[j].type in (tokenize.NL, tokenize.NEWLINE, tokenize.INDENT, tokenize.DEDENT):
            j -= 1
        return toks[j] if j >= 0 else None

    def next_sig(i):
        j = i + 1
        while j < len(toks) and toks[j].type in (tokenize.NL, tokenize.NEWLINE, tokenize.INDENT, tokenize.DEDENT):
            j += 1
        return toks[j] if j < len(toks) else None

    for i, t in enumerate(toks):
        if t.type == tokenize.NAME and t.string in ("float", "int"):
            p = prev_sig(i)
            n = next_sig(i)
            # obj.float(...) みたいな属性呼び出しは除外（直前が '.' なら触らない）
            if p and p.type == tokenize.OP and p.string == ".":
                out.append(t)
                continue
            # 次が '(' のときだけ “関数呼び出し” とみなして置換
            if n and n.type == tokenize.OP and n.string == "(":
                if t.string == "float":
                    out.append(tokenize.TokenInfo(t.type, "_to_float", t.start, t.end, t.line))
                    rep_float += 1
                    continue
                if t.string == "int":
                    out.append(tokenize.TokenInfo(t.type, "_to_int", t.start, t.end, t.line))
                    rep_int += 1
                    continue
        out.append(t)

    new_code = tokenize.untokenize(out)
    return new_code, rep_float, rep_int

for p in TARGETS:
    if not p.exists():
        print(f"[SKIP] not found: {p}")
        continue

    bak = backup(p)
    code = p.read_text(encoding="utf-8-sig")
    print(f"[OK] backup -> {bak}")

    # helper注入（1回だけ）
    if HELPER_MARK not in code:
        # import 群の直後に入れる（雑に安全）
        m = re.search(r"(?m)^(?:from __future__.*\n)?(?:import .*\n|from .* import .*\n)+", code)
        if m:
            ins = m.end()
            code = code[:ins] + "\n" + HELPER_BLOCK + "\n" + code[ins:]
            print(f"[OK] injected {HELPER_MARK} into {p.name}")
        else:
            code = HELPER_BLOCK + "\n" + code
            print(f"[OK] injected {HELPER_MARK} at top into {p.name}")
    else:
        print(f"[OK] {HELPER_MARK} already present in {p.name}")

    # float()/int() 呼び出しを安全版に
    code2, nf, ni = replace_float_int_calls(code)
    p.write_text(code2, encoding="utf-8-sig")
    print(f"[OK] patched {p.name}: float->{nf}, int->{ni}")

print("[DONE]")

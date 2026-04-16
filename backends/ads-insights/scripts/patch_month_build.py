from pathlib import Path
import re, sys

p = Path("generate_reports.py")
s = p.read_text(encoding="utf-8")

# 1) 月を "01" 固定みたいにしてしまう典型ロジックを潰す（"([01]\d)" 周り）
# 2) m.group(2) を1文字だけ参照してるやつを潰す
# 3) 最終的に必ず int化 & 2桁化して返す

# まず "tag =" を作ってる箇所を狙い撃ち（かなり確率高い）
patterns = [
    # tag = f"{y:04d}-{m.group(2):02d}" 的なやつ
    (r'tag\s*=\s*f["\']\{y:04d\}-\{[^}]*group\(2\)[^}]*\}["\']',
     'tag = f"{y:04d}-{mo:02d}"'),
    # return f"{y}-{m}" 的なやつ
    (r'return\s+f["\']\{y[^}]*\}-\{[^}]*group\(2\)[^}]*\}["\']',
     'return f"{y:04d}-{mo:02d}"'),
]

# monthを mo=int(m.group(2)) に統一する（存在しない場合は後で挿入）
# 既に "mo =" があるならそれを信じる
need_insert_mo = ("mo =" not in s)

# group(2)[0] を group(2) に戻す（まず致命バグを排除）
s2 = re.sub(r'group\(2\)\s*\[\s*0\s*\]', 'group(2)', s)

# 置換を適用
changed = 0
for pat, rep in patterns:
    if re.search(pat, s2):
        s2, n = re.subn(pat, rep, s2)
        changed += n

# mo の定義を、mが見つかった直後に差し込む（無ければ）
if need_insert_mo:
    # "if m:" の次行に挿入するのが一番安全
    s2, n = re.subn(
        r'(\n\s*if\s+m\s*:\s*\n)',
        r'\1        y = int(m.group(1))\n        mo = int(m.group(2))\n',
        s2,
        count=1
    )
    if n == 0:
        print("ERROR: could not insert mo definition (pattern 'if m:' not found).", file=sys.stderr)
        sys.exit(1)
    changed += 1

# y/mo が入ったなら tag 組み立ても安全化（未ヒットでも最後の保険で置換）
# 「12が01になる」系を潰すため、moの int化を前提にする
p.write_text(s2, encoding="utf-8")
print(f"OK: patched (changes={changed})")

from pathlib import Path
import sys

p = Path("generate_reports.py")
s = p.read_text(encoding="utf-8")

needle = r"(20\d{2}).{0,20}?([01]?\d)"
repl   = r"(20\d{2})(?:[^\dA-Za-z]{0,20}?)(0?[1-9]|1[0-2])"

cnt = s.count(needle)
if cnt == 0:
    print("ERROR: target pattern not found:", needle, file=sys.stderr)
    # 近い候補行を出す（手元で次の一手が打てるように）
    for i, line in enumerate(s.splitlines(), 1):
        if ".{0,20}?" in line or "month_tag" in line:
            print(f"[hint:{i}] {line}", file=sys.stderr)
    sys.exit(1)

s2 = s.replace(needle, repl)
p.write_text(s2, encoding="utf-8")
print(f"OK: replaced {cnt} occurrence(s)")

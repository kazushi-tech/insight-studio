from pathlib import Path
import sys

p = Path("generate_reports.py")
s = p.read_text(encoding="utf-8")

needle = r"(20\d{2})(?:[^\dA-Za-z]{0,20}?)(0?[1-9]|1[0-2])"
repl   = r"(20\d{2})(?:[^\dA-Za-z]{0,20}?)(0?[1-9]|1[0-2])(?!\d)"

cnt = s.count(needle)
if cnt == 0:
    print("ERROR: target pattern not found:", needle, file=sys.stderr)
    sys.exit(1)

p.write_text(s.replace(needle, repl), encoding="utf-8")
print(f"OK: patched boundary (replaced {cnt})")

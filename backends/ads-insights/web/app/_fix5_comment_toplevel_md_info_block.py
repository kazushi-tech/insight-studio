from __future__ import annotations

import datetime as dt
import re
from pathlib import Path

APP = Path("web/app/app.py")
if not APP.exists():
    raise SystemExit(f"not found: {APP.resolve()}")

ts = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
bak = APP.with_name(APP.name + f".bak.fix5.{ts}")
bak.write_bytes(APP.read_bytes())
print(f"[OK] backup -> {bak}")

s = APP.read_text(encoding="utf-8-sig")
lines = s.splitlines(True)

# 目的:
# - app.py の “module top-level” で _md/_info を触るブロックを丸ごと無効化
# - main() 内の処理は残す
#
# 方針:
# - `if __name__ == "__main__":` より前の領域だけを対象にする（streamlit は通常ここより上で動く）
# - その中で `_md` / `_info` / `parse_audit_info` / `infer_data_dir_from_any_compare` を含む行を全部コメント化
#   （※main() 内はインデントが深いので、後で main() 注入に寄せる）

# 1) 対象範囲を "__main__" 手前までに限定（無ければ全体）
cut = len(lines)
for i, ln in enumerate(lines):
    if re.search(r'^\s*if\s+__name__\s*==\s*[\'"]__main__[\'"]\s*:', ln):
        cut = i
        break

out = []
n = 0
targets = ("_md", "_info", "parse_audit_info", "infer_data_dir_from_any_compare")

for i, ln in enumerate(lines):
    if i < cut and any(t in ln for t in targets):
        # import 行は残す
        if re.match(r"^\s*(from|import)\s+", ln):
            out.append(ln)
            continue
        # 既にパッチ済みはそのまま
        if "PATCHED_" in ln:
            out.append(ln)
            continue
        out.append("# [PATCHED_TOPLEVEL_BLOCK] " + ln)
        n += 1
    else:
        out.append(ln)

APP.write_text("".join(out), encoding="utf-8-sig")
print(f"[OK] commented lines in top-level block: {n}")
print("[DONE]")

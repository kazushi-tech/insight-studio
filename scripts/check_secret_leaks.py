"""High-confidence secret scan over files tracked by git.

This intentionally reports only provider formats and private-key blocks with a
low false-positive rate.  Values are never echoed back to CI logs.
"""

from __future__ import annotations

from pathlib import Path
import re
import subprocess


PATTERNS = {
    "private key": re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    "AWS access key": re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b"),
    "Google API key": re.compile(r"\bAIza[0-9A-Za-z_-]{35}\b"),
    "GitHub token": re.compile(r"\bgh(?:p|o|u|s|r)_[0-9A-Za-z]{30,}\b"),
    "Slack token": re.compile(r"\bxox(?:b|p|a|r|s)-[0-9A-Za-z-]{20,}\b"),
    "Stripe live key": re.compile(r"\b(?:sk|rk)_live_[0-9A-Za-z]{16,}\b"),
    "Clerk live secret": re.compile(r"\bsk_live_[0-9A-Za-z]{16,}\b"),
    "webhook signing secret": re.compile(r"\bwhsec_[0-9A-Za-z]{24,}\b"),
}
MAX_TEXT_BYTES = 2 * 1024 * 1024


def main() -> int:
    completed = subprocess.run(
        ["git", "ls-files", "-z"], check=True, stdout=subprocess.PIPE
    )
    findings: list[tuple[str, str, int]] = []
    for raw_path in completed.stdout.split(b"\0"):
        if not raw_path:
            continue
        path = Path(raw_path.decode("utf-8", errors="surrogateescape"))
        try:
            if not path.is_file() or path.stat().st_size > MAX_TEXT_BYTES:
                continue
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        for name, pattern in PATTERNS.items():
            match = pattern.search(text)
            if match:
                findings.append((path.as_posix(), name, text.count("\n", 0, match.start()) + 1))

    if findings:
        print("::error::high-confidence secret material found in tracked files")
        for path, name, line in findings:
            print(f"- {path}:{line}: {name} (value redacted)")
        return 1

    print("Tracked-file secret scan passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""Read-only final whitespace, receipt-secret and record-link checks (120s wall limit)."""
import json
from pathlib import Path
import re
import signal
import subprocess

signal.alarm(120)
root = Path(__file__).resolve().parents[4]
base = root / "docs/evidence/phase-2-follow-up"
patterns = {
    "literal-bearer": re.compile(r"Bearer [A-Za-z0-9_-]{24,}"),
    "url-password": re.compile(r"(?:postgres(?:ql)?|https?|socks5)://[^\s/@:]+:([^\s/@]+)@"),
    "private-key": re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    "literal-secret": re.compile(r'"(?:token|secret|password|access_key|secret_key)"\s*:\s*"(?!env:|file:)[A-Za-z0-9_+/=-]{24,}"'),
}
hits = []
files = 0
for path in base.rglob("*"):
    if not path.is_file() or path.suffix.lower() in {".png", ".jpg", ".webp"}:
        continue
    try:
        text = path.read_text()
    except UnicodeError:
        continue
    files += 1
    for name, pattern in patterns.items():
        if pattern.search(text):
            hits.append({"path": str(path.relative_to(root)), "pattern": name})
output_file = base / "lead/final-inspection-final.json"
links = []
for name in ["phase-2-follow-up-record.md", "phase-2-remaining-checklist.md"]:
    doc = root / "docs/specs" / name
    for link in re.findall(r"\[[^\]]*\]\(([^)]+)\)", doc.read_text()):
        if not link.startswith(("https://", "http://", "#")):
            path = (doc.parent / link.split("#")[0]).resolve()
            if not path.exists() and path != output_file:
                links.append({"document": name, "missing": link})
broad_command = ["git", "diff", "--cached", "--check"]
broad = subprocess.run(broad_command, cwd=root, text=True, capture_output=True, timeout=30)
diagnostics = [line for line in broad.stdout.splitlines() if line.startswith("docs/")]
expected_raw = all(line.split(":", 1)[0].startswith("docs/evidence/phase-2-follow-up/") and line.split(":", 1)[0].endswith(".log") for line in diagnostics)
command = ["git", "diff", "--cached", "--check", "--", ".", ":(exclude,glob)docs/evidence/phase-2-follow-up/**/*.log"]
checked = subprocess.run(command, cwd=root, text=True, capture_output=True, timeout=30)
result = {"outcome": "PASS" if not hits and not links and checked.returncode == 0 and expected_raw else "FAIL", "wall_timeout_seconds": 120, "secret_scan": {"files": files, "potential_hits": hits, "method": "Literal credential patterns; paths/labels only on a hit, never matching values. Secret values remain inherited env/owner-only references."}, "record_links": {"missing": links}, "whitespace": {"command": command, "exit": checked.returncode, "output": checked.stdout + checked.stderr, "scope": "All staged source, documentation, JSON, tools and tests; immutable raw .log evidence excluded only from whitespace normalization."}, "unmodified_raw_log_check": {"command": broad_command, "exit": broad.returncode, "diagnostics": diagnostics, "only_immutable_raw_logs": expected_raw, "explanation": "Original LLDB/terminal spacing is retained byte-for-byte with its hashes. It is evidence data, not formatted source. Generic *.log ignore was explicitly overridden for these owned receipts."}}
output_file.open("x").write(json.dumps(result, indent=2) + "\n")
assert json.loads(output_file.read_text())["outcome"] == result["outcome"]
print(json.dumps({"outcome": result["outcome"], "text_files": files, "secret_hits": hits, "missing_links": links, "formatted_whitespace_exit": checked.returncode, "raw_log_diagnostics": len(diagnostics)}))
raise SystemExit(0 if result["outcome"] == "PASS" else 1)

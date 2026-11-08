"""Canonical artifact tree SHA-256; does not follow symlinks."""
import hashlib
import json
import os
from pathlib import Path
import stat
import sys

app = Path(sys.argv[1])
if not app.is_dir():
    raise SystemExit(f"Package directory unavailable: {app}")
def inaccessible(error):
    raise error

entries = []
for base, directories, files in os.walk(app, followlinks=False, onerror=inaccessible):
    directories.sort()
    files.sort()
    for name in sorted(directories + files):
        path = Path(base) / name
        relative = path.relative_to(app).as_posix()
        mode = stat.S_IMODE(path.lstat().st_mode)
        if path.is_symlink():
            entries.append([relative, "symlink", mode, os.readlink(path)])
        elif path.is_file():
            entries.append([relative, "file", mode, path.stat().st_size, hashlib.sha256(path.read_bytes()).hexdigest()])
        elif path.is_dir():
            entries.append([relative, "directory", mode])
entries.sort(key=lambda entry: entry[0])
payload = json.dumps(entries, ensure_ascii=False, separators=(",", ":")).encode()
print(json.dumps({"method": "SHA256 UTF8 compact JSON array sorted by relative POSIX path; entries [relative,type,mode,size,fileSHA256] for files, [relative,type,mode,target] for symlinks, [relative,type,mode] for directories; root excluded; no symlink traversal", "tree_sha256": hashlib.sha256(payload).hexdigest(), "entries": len(entries), "source_commit": "da2986c4771b9edb89db0b6761b3781ae8a1d7fa", "original_identity_receipt": "final-package-identity.json", "app": str(app)}, indent=2))

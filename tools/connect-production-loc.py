#!/usr/bin/env python3
"""Reproducible Connect product-source comparison of Git snapshots.

Uses LayerFS's pinned JS comment scanner for both snapshots. Includes host/,
legacy src/ and desktop/src/ JS/TS/TSX/CSS plus shipped host JSON. Excludes
external tests, simulator/mocks/sample data and generated call-table data.
"""
import argparse
import ast
import json
from pathlib import PurePosixPath
import subprocess

PIN = "67310175ebba2b84efefb4df76f875a43487cf50"
parser = argparse.ArgumentParser()
parser.add_argument("before")
parser.add_argument("after")
parser.add_argument("--counter-repo", default="../layerfs")
args = parser.parse_args()
source = subprocess.check_output(["git", "-C", args.counter_repo, "show", f"{PIN}:tools/production_loc.py"], text=True)
node = next(n for n in ast.parse(source).body if isinstance(n, ast.FunctionDef) and n.name == "blank_js")
namespace = {}
exec(compile(ast.Module(body=[node], type_ignores=[]), "pinned-blank-js", "exec"), namespace)
blank_js = namespace["blank_js"]

def product(name):
    path = PurePosixPath(name)
    if not name.startswith(("host/", "src/", "desktop/src/")):
        return False
    if any(part in {"test", "tests", "simulation", "node_modules", "assets"} for part in path.parts):
        return False
    if name.startswith("host/sim/") or "preview" in path.stem.lower() or "sample" in path.stem.lower() or path.stem.endswith("-sim"):
        return False
    return path.suffix in {".js", ".mjs", ".ts", ".tsx", ".css"} or name.startswith("host/") and path.suffix == ".json"

def count(ref):
    files = subprocess.check_output(["git", "ls-tree", "-r", "--name-only", ref], text=True).splitlines()
    scopes = {"host": 0, "desktop": 0, "legacy": 0}
    for name in filter(product, files):
        text = subprocess.check_output(["git", "show", f"{ref}:{name}"], text=True)
        loc = sum(bool(line.strip()) for line in blank_js(text).splitlines())
        scopes["host" if name.startswith("host/") else "desktop" if name.startswith("desktop/") else "legacy"] += loc
    return {"total": sum(scopes.values()), **scopes}

before, after = count(args.before), count(args.after)
print(json.dumps({"before_ref": args.before, "after_ref": args.after, "counter": f"LayerFS {PIN}:tools/production_loc.py blank_js", "before": before, "after": after, "delta": after["total"] - before["total"]}, indent=2))

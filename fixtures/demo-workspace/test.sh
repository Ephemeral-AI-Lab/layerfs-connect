# Stands in for `npm test`: every page renders a heading, and every "@/…" import resolves.
set -e
for f in app/page.tsx app/*/page.tsx; do
  [ -f "$f" ] || continue
  grep -q "<h1>" "$f" || { echo "FAIL $f has no heading"; exit 1; }
  echo "ok $f"
done
for f in $(find app lib \( -name '*.ts' -o -name '*.tsx' \) 2>/dev/null); do
  for m in $(grep -o 'from "@/[^"]*"' "$f" | cut -d'"' -f2 | cut -c3-); do
    [ -f "$m.ts" ] || [ -f "$m.tsx" ] || { echo "FAIL $f: Cannot find module '@/$m'"; exit 1; }
  done
done
echo "tests passed"

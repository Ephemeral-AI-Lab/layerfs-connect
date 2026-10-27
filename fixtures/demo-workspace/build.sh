# Stands in for `next build`: lints the pages, then writes .next/.
# --slow takes about ten seconds, for running in the background.
set -e
[ -d node_modules/next ] || { echo "next: not installed (run sh install.sh)"; exit 1; }
[ "$1" = "--slow" ] && sleep 10
bad=$(grep -ln "<h1>[^<]*'[^<]*</h1>" app/*.tsx app/*/*.tsx 2>/dev/null || true)
if [ -n "$bad" ]; then
  for f in $bad; do echo "$f: Error: \`'\` can be escaped with \`&apos;\`  react/no-unescaped-entities"; done
  echo "Failed to compile."
  exit 1
fi
mkdir -p .next/server/app
for f in app/*.tsx app/*/*.tsx; do
  [ -f "$f" ] || continue
  mkdir -p ".next/server/$(dirname "$f")"
  cp "$f" ".next/server/$f.html"
done
# a new id per build, as next build makes: two builds in one second still differ
echo "$(date +%s)-$(od -An -N4 -tu4 /dev/urandom | tr -d ' ')" > .next/BUILD_ID
echo "Compiled successfully: $(find .next/server -name '*.html' | wc -l | tr -d ' ') pages"

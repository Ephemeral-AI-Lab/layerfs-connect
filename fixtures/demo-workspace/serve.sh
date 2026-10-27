# Stands in for `next start`: serves each page's heading on localhost:3000
# until stopped, keeping a dev cache. When the port is taken (simulated
# Workspaces share the host's localhost) it runs without serving.
mkdir -p .next/cache
echo '{}' > .next/cache/dev.json
echo "ready on http://localhost:3000"
exec python3 -c '
import http.server, os, re, time
class Page(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        page = "app" + self.path.split("?")[0].rstrip("/") + "/page.tsx"
        found = os.path.isfile(page) and re.search(r"<h1>(.*?)</h1>", open(page).read())
        self.send_response(200 if found else 404)
        self.end_headers()
        self.wfile.write(("<h1>%s</h1>\n" % (found.group(1) if found else "404: This page could not be found.")).encode())
    def log_message(self, *args):
        pass
try:
    server = http.server.HTTPServer(("127.0.0.1", 3000), Page)
except OSError:  # another simulated Workspace serves here: keep running, serving nothing
    print("localhost:3000 is taken; running without serving", flush=True)
    while True:
        time.sleep(3600)
server.serve_forever()
'

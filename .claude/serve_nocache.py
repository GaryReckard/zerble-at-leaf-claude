"""Dev-only static server that disables HTTP caching so module reloads pick up
edited files. Plain `python3 -m http.server` sends Last-Modified but no
Cache-Control, and Chrome's heuristic cache happily holds ES module bodies."""

import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    server = ThreadingHTTPServer(('127.0.0.1', port), NoCacheHandler)
    print(f'serving on http://127.0.0.1:{port} (no-cache)')
    server.serve_forever()

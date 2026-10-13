"""Dev server: static files from this folder with caching disabled, so edits show up on reload.

    python serve.py          # http://localhost:8765
    python serve.py 9000     # another port
"""
import http.server
import sys
from functools import partial
from pathlib import Path


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    handler = partial(NoCacheHandler, directory=str(Path(__file__).parent))
    with http.server.ThreadingHTTPServer(("127.0.0.1", port), handler) as httpd:
        print(f"Serving on http://localhost:{port}  (staff: /apps/staff/, student: /apps/student/)")
        httpd.serve_forever()

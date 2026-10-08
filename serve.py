#!/usr/bin/env python3
"""Статическая раздача читалки. Локально: python3 serve.py [порт]."""
import http.server, os, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 18915


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        '.webmanifest': 'application/manifest+json',
        '.js': 'text/javascript',
        '.epub': 'application/epub+zip',
        '.fb2': 'application/xml',
    }

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def end_headers(self):
        # service worker и страница не должны залипать в кеше браузера
        if self.path.rstrip('/') in ('', '/index.html') or self.path.endswith('sw.js'):
            self.send_header('Cache-Control', 'no-cache')
        self.end_headers_orig()

    end_headers_orig = http.server.SimpleHTTPRequestHandler.end_headers

    def log_message(self, fmt, *args):
        sys.stderr.write('%s %s\n' % (self.log_date_time_string(), fmt % args))


if __name__ == '__main__':
    http.server.ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()

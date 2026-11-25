"""Serve the local demo with MP4 byte ranges for frame-accurate browser seeks."""
import argparse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import re


class DemoHandler(SimpleHTTPRequestHandler):
    def send_head(self):
        self.byte_count = None
        requested = self.headers.get("Range")
        target = Path(self.translate_path(self.path))
        if not requested or not target.is_file():
            return super().send_head()
        size = target.stat().st_size
        match = re.fullmatch(r"bytes=(\d*)-(\d*)", requested)
        if match and any(match.groups()):
            start_text, end_text = match.groups()
            if start_text:
                start = int(start_text)
                end = min(size - 1, int(end_text)) if end_text else size - 1
            else:
                start, end = max(0, size - int(end_text)), size - 1
            if start <= end:
                stream = target.open("rb")
                stream.seek(start)
                self.byte_count = end - start + 1
                self.send_response(206)
                self.send_header("Content-Type", self.guess_type(str(target)))
                self.send_header("Accept-Ranges", "bytes")
                self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
                self.send_header("Content-Length", str(self.byte_count))
                self.end_headers()
                return stream
        self.send_response(416)
        self.send_header("Content-Range", f"bytes */{size}")
        self.send_header("Content-Length", "0")
        self.end_headers()
        return None

    def copyfile(self, source, output):
        if self.byte_count is None:
            return super().copyfile(source, output)
        remaining = self.byte_count
        while remaining:
            chunk = source.read(min(remaining, 65536))
            if not chunk:
                break
            try:
                output.write(chunk)
            except (BrokenPipeError, ConnectionResetError):
                break
            remaining -= len(chunk)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=18736)
    args = parser.parse_args()
    directory = str(Path(__file__).resolve().parents[1])
    def handler(*params, **kwargs):
        return DemoHandler(*params, directory=directory, **kwargs)
    ThreadingHTTPServer(("127.0.0.1", args.port), handler).serve_forever()

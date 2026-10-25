"""Small HTTP service that lets the studio download and remove Wan2GP models.

Runs next to WanGP's MCP server in the wan2gp container, on the internal compose network only
(nothing publishes its port). Each operation runs zf_models.py as a child process with an
argument list (never a shell), so WanGP's code runs exactly as in a generation.

  GET    /health
  GET    /download            current or last download
  POST   /download            {"model_type": "..."}   start (one at a time)
  DELETE /download            cancel the running download
  POST   /status              {"model_types": [...]}  status and size on disk
  POST   /remove              {"model_type": "...", "keep": [...]}
"""

import json
import os
import re
import signal
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
TOOL = os.path.join(HERE, "zf_models.py")
PORT = int(os.environ.get("ZF_MODEL_TOOLS_PORT", "7867"))
EVENT_PREFIX = "ZF-EVENT "
MODEL_TYPE = re.compile(r"^[A-Za-z0-9_.-]{1,100}$")
MAX_BODY = 64 * 1024
# Starting WanGP's code takes about a minute; removing or measuring files is quick after that.
COMMAND_TIMEOUT_S = 900

_lock = threading.Lock()
_download = {"status": "idle"}
_process = None


def received_bytes():
    """Bytes received by this container so far. Hugging Face's Xet transfers report file progress
    only in large steps, so the studio also shows how much has arrived."""
    total = 0
    with open("/proc/net/dev") as f:
        for line in f.readlines()[2:]:
            name, data = line.split(":", 1)
            if name.strip() != "lo":
                total += int(data.split()[0])
    return total


def download_state():
    state = dict(_download)
    if state.get("status") in ("running", "cancelling") and "rx_start" in state:
        state["received"] = received_bytes() - state["rx_start"]
    state.pop("rx_start", None)
    return state


def run_tool(args):
    """Runs zf_models.py to completion and returns its last event."""
    proc = subprocess.run([sys.executable, TOOL, *args], cwd="/opt/wan2gp", stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                          text=True, timeout=COMMAND_TIMEOUT_S, check=False)
    last = None
    for line in proc.stdout.splitlines():
        if line.startswith(EVENT_PREFIX):
            last = json.loads(line[len(EVENT_PREFIX):])
        else:
            print(line, file=sys.stderr)
    return last or {"event": "error", "message": f"zf_models.py exited with code {proc.returncode}"}


def follow_download(proc, model_type):
    global _process
    error = None
    for line in proc.stdout:
        if not line.startswith(EVENT_PREFIX):
            sys.stderr.write(line)
            continue
        event = json.loads(line[len(EVENT_PREFIX):])
        with _lock:
            if event["event"] == "progress":
                _download.update({k: event.get(k) for k in ("file", "completed", "total", "speed", "file_index", "file_count")})
            elif event["event"] == "error":
                error = event.get("message")
            elif event["event"] == "done":
                _download["model_status"] = event.get("status")
    code = proc.wait()
    with _lock:
        if _download.get("status") == "cancelling":
            _download["status"] = "cancelled"
        elif code == 0:
            _download["status"] = "succeeded"
        else:
            _download.update(status="failed", error=error or f"Download exited with code {code}")
        _download["finished_at"] = time.time()
        _process = None


def start_download(model_type):
    global _download, _process
    with _lock:
        if _process is not None:
            return 409, {"error": f"A download is already running ({_download.get('model_type')})"}
        _process = subprocess.Popen([sys.executable, TOOL, "download", model_type], cwd="/opt/wan2gp", stdout=subprocess.PIPE,
                                    stderr=subprocess.STDOUT, text=True, start_new_session=True)
        _download = {"status": "running", "model_type": model_type, "started_at": time.time(), "rx_start": received_bytes()}
        threading.Thread(target=follow_download, args=(_process, model_type), daemon=True).start()
        return 202, download_state()


def cancel_download():
    with _lock:
        if _process is None:
            return 409, {"error": "No download is running"}
        _download["status"] = "cancelling"
        os.killpg(_process.pid, signal.SIGTERM)
        return 202, download_state()


class Handler(BaseHTTPRequestHandler):
    server_version = "zf-model-tools"

    def log_message(self, fmt, *args):
        sys.stderr.write("[model-tools] " + (fmt % args) + "\n")

    def send_json(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def read_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY:
            raise ValueError("JSON body required (max 64 KB)")
        body = json.loads(self.rfile.read(length))
        if not isinstance(body, dict):
            raise ValueError("JSON object required")
        return body

    @staticmethod
    def model_type(value):
        if not isinstance(value, str) or not MODEL_TYPE.match(value):
            raise ValueError("invalid model_type")
        return value

    def do_GET(self):
        if self.path == "/health":
            return self.send_json(200, {"ok": True})
        if self.path == "/download":
            with _lock:
                return self.send_json(200, download_state())
        self.send_json(404, {"error": "Not found"})

    def do_DELETE(self):
        if self.path == "/download":
            return self.send_json(*cancel_download())
        self.send_json(404, {"error": "Not found"})

    def do_POST(self):
        try:
            body = self.read_body()
            if self.path == "/download":
                return self.send_json(*start_download(self.model_type(body.get("model_type"))))
            if self.path == "/status":
                types = body.get("model_types")
                if not isinstance(types, list) or not 0 < len(types) <= 50:
                    raise ValueError("model_types must be a list of 1-50 names")
                return self.send_json(200, run_tool(["status", *[self.model_type(t) for t in types]]))
            if self.path == "/remove":
                model_type = self.model_type(body.get("model_type"))
                keep = body.get("keep", [])
                if not isinstance(keep, list) or len(keep) > 50:
                    raise ValueError("keep must be a list of at most 50 names")
                with _lock:
                    if _process is not None and _download.get("model_type") == model_type:
                        return self.send_json(409, {"error": "This model is being downloaded; cancel the download first"})
                result = run_tool(["remove", model_type, "--keep", *[self.model_type(t) for t in keep]])
                return self.send_json(200 if result.get("event") == "removed" else 500, result)
            self.send_json(404, {"error": "Not found"})
        except (ValueError, json.JSONDecodeError) as exc:
            self.send_json(400, {"error": str(exc)})
        except subprocess.TimeoutExpired:
            self.send_json(504, {"error": "Wan2GP did not answer in time"})


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()

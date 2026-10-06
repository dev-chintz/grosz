"""Updater grosza (wzorem Anvero): na prośbę aplikacji uruchamia deploy/deploy.sh i raportuje postęp.

Ma gniazdo Dockera, czyli praktycznie roota na NAS-ie, więc jest mały i zamknięty: nie wystawia portu
(słucha tylko w sieci Dockera projektu), przyjmuje wyłącznie żądania z UPDATER_TOKEN i umie jedną rzecz —
zawsze to samo polecenie. Tylko biblioteka standardowa.

    GET  /status   stan ostatniego przebiegu: kroki (linie „== …” ze skryptu), wynik, końcówka logu
    POST /update   start; 202, albo 409, gdy przebieg już trwa

Środowisko: UPDATER_TOKEN (wymagany, min. 32 znaki), PROJECT_DIR (folder grosza na NAS-ie, zamontowany
pod tą samą ścieżką, bo deploy.sh montuje go dalej w kontenery), PORT (domyślnie 8080).
"""

import hmac
import json
import os
import subprocess
import sys
import threading
from datetime import UTC, datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

LOG_KEPT = 6000


def _now() -> str:
    return datetime.now(UTC).isoformat()


class Updater:
    def __init__(self, project_dir: str):
        self.project_dir = project_dir
        self._lock = threading.Lock()
        self.state = {"running": False, "startedAt": None, "finishedAt": None, "result": None, "steps": [], "log": ""}

    def start(self) -> bool:
        with self._lock:
            if self.state["running"]:
                return False
            self.state.update(running=True, startedAt=_now(), finishedAt=None, result=None, steps=[], log="")
        threading.Thread(target=self._work, daemon=True).start()
        return True

    def _append(self, line: str) -> None:
        with self._lock:
            if line.startswith("== "):
                self.state["steps"].append({"title": line[3:].strip(), "at": _now()})
            self.state["log"] = (self.state["log"] + line + "\n")[-LOG_KEPT:]

    def _work(self) -> None:
        result = "ok"
        try:
            process = subprocess.Popen(
                ["sh", "deploy/deploy.sh"],
                cwd=self.project_dir,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                env={**os.environ, "RUNNING_IN_UPDATER": "1"},
            )
            for line in process.stdout:
                print(line, end="", flush=True)
                self._append(line.rstrip("\n"))
            if process.wait(timeout=1800) != 0:
                result = "failed"
        except Exception as exc:  # brak dockera, przekroczony czas
            self._append(repr(exc))
            result = "failed"
        with self._lock:
            self.state.update(running=False, finishedAt=_now(), result=result)


def make_handler(updater: Updater, token: str):
    class Handler(BaseHTTPRequestHandler):
        def _authorized(self) -> bool:
            return hmac.compare_digest(self.headers.get("Authorization", "").encode(), f"Bearer {token}".encode())

        def _send(self, code: int, body: dict) -> None:
            data = json.dumps(body).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            if not self._authorized():
                return self._send(401, {"error": "unauthorized"})
            if self.path != "/status":
                return self._send(404, {"error": "not found"})
            with updater._lock:
                self._send(200, json.loads(json.dumps(updater.state)))

        def do_POST(self):
            if not self._authorized():
                return self._send(401, {"error": "unauthorized"})
            if self.path != "/update":
                return self._send(404, {"error": "not found"})
            if not updater.start():
                return self._send(409, {"error": "aktualizacja już trwa"})
            self._send(202, {"started": True})

        def log_message(self, format, *args):
            # tylko metoda i ścieżka — nigdy nagłówki (token)
            sys.stderr.write(f"{self.command} {self.path.split('?')[0]}\n")

    return Handler


def main() -> int:
    token = os.environ.get("UPDATER_TOKEN", "").strip()
    if len(token) < 32:
        print("UPDATER_TOKEN musi mieć co najmniej 32 losowe znaki", file=sys.stderr)
        return 1
    project_dir = os.environ.get("PROJECT_DIR", "/share/Container/grosz")
    port = int(os.environ.get("PORT", "8080"))
    print(f"grosz updater: {project_dir}, port {port}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", port), make_handler(Updater(project_dir), token)).serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

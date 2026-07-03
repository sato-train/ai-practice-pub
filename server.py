import json
import base64
import os
import socketserver
import sys
import threading
import subprocess
import webbrowser
from datetime import datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HOST = "127.0.0.1"
PORT = 8000
APP_DIR = Path(__file__).resolve().parent
CONFIG_DIR = Path(os.environ.get("LOCALAPPDATA", APP_DIR)) / "DailyMemo"
CONFIG_FILE = CONFIG_DIR / "config.json"
CODEX_CANDIDATES = [
    Path(r"C:\Users\USER\.codex\plugins\.plugin-appserver\codex.exe"),
    Path(r"C:\Users\USER\.codex\.sandbox-bin\codex.exe"),
]


class CodexError(Exception):
    pass


class LocalThreadingHTTPServer(ThreadingHTTPServer):
    """ローカル起動時に不要なホスト名の逆引きを行わない。"""
    def server_bind(self):
        socketserver.TCPServer.server_bind(self)
        self.server_name = self.server_address[0]
        self.server_port = self.server_address[1]


class DailyMemoHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(APP_DIR), **kwargs)

    def log_message(self, fmt, *args):
        print(f"[{datetime.now().isoformat(timespec='seconds')}] {fmt % args}")

    def send_json(self, status, data):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > 1_000_000:
            raise ValueError("リクエストのサイズが不正です。")
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def do_GET(self):
        if self.path == "/api/today":
            path, content = get_today_markdown()
            self.send_json(200, {
                "exists": content is not None,
                "path": str(path) if path else "",
                "markdown": content or "",
            })
            return
        if self.path == "/api/status":
            save_dir = get_save_dir()
            self.send_json(200, {
                "codexAvailable": bool(find_codex()),
                "provider": "Codex CLI / ChatGPT",
                "saveDirectory": str(save_dir) if save_dir else "",
                "saveDirectoryConfigured": save_dir is not None,
            })
            return
        super().do_GET()

    def do_POST(self):
        if self.path == "/api/browse-directory":
            try:
                selected = browse_directory()
                self.send_json(200, {"selected": bool(selected), "path": selected or ""})
            except OSError as error:
                self.send_json(500, {"error": f"フォルダ選択画面を開けませんでした: {error}"})
            return

        if self.path == "/api/settings":
            try:
                data = self.read_json()
                save_dir = save_settings(str(data.get("saveDirectory", "")).strip())
                self.send_json(200, {"saveDirectory": str(save_dir)})
            except (ValueError, OSError) as error:
                self.send_json(400, {"error": str(error)})
            return

        if self.path != "/api/summarize":
            self.send_json(404, {"error": "Not found"})
            return

        try:
            data = self.read_json()
            memos = {
                "morning": str(data.get("morning", "")).strip(),
                "noon": str(data.get("noon", "")).strip(),
                "night": str(data.get("night", "")).strip(),
            }
            if not any(memos.values()):
                self.send_json(400, {"error": "朝・昼・夜のメモを1つ以上入力してください。"})
                return

            if not get_save_dir():
                self.send_json(400, {"error": "先に保存先を設定してください。"})
                return

            if not find_codex():
                self.send_json(503, {"error": "Codex CLIが見つかりません。"})
                return

            summary = call_codex(memos)
            saved_path = save_markdown(memos, summary)
            self.send_json(200, {
                "summary": summary,
                "markdown": saved_path.read_text(encoding="utf-8"),
                "savedPath": str(saved_path),
            })
        except CodexError as error:
            self.send_json(502, {"error": str(error)})
        except (ValueError, json.JSONDecodeError) as error:
            self.send_json(400, {"error": str(error)})
        except OSError as error:
            print(f"[File error] {error}", file=sys.stderr)
            self.send_json(500, {"error": f"Markdownを保存できませんでした: {error}"})
        except Exception as error:
            print(f"[Unexpected error] {error}", file=sys.stderr)
            self.send_json(500, {"error": "処理中に予期しないエラーが発生しました。"})


def build_prompt(memos):
    return f"""以下は私の今日1日の音声メモです。
内容を日本語で簡潔に整理してください。見出しと箇条書きを使い、次の3項目を必ず含めてください。

## 明日以降に活かせること
## AIや仕組みで解決できそうなもの
## 継続するべきこと・やめるべきこと

【朝のメモ】
{memos['morning'] or '（未入力）'}

【昼のメモ】
{memos['noon'] or '（未入力）'}

【夜のメモ】
{memos['night'] or '（未入力）'}
"""


def find_codex():
    return next((path for path in CODEX_CANDIDATES if path.exists()), None)


def get_save_dir():
    try:
        data = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
        value = str(data.get("saveDirectory", "")).strip()
        return Path(value) if value else None
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return None


def save_settings(value):
    if not value:
        raise ValueError("保存先を入力してください。")
    save_dir = Path(value)
    if not save_dir.is_absolute():
        raise ValueError("保存先は絶対パスで入力してください。")
    save_dir.mkdir(parents=True, exist_ok=True)
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    CONFIG_FILE.write_text(
        json.dumps({"saveDirectory": str(save_dir)}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return save_dir


def browse_directory():
    script = """
$shell = New-Object -ComObject Shell.Application
$folder = $shell.BrowseForFolder(0, 'Daily Memo の保存先を選択してください', 0x00000040, 0)
if ($folder) { [Console]::OutputEncoding = [Text.Encoding]::UTF8; Write-Output $folder.Self.Path }
"""
    encoded = base64.b64encode(script.encode("utf-16le")).decode("ascii")
    result = subprocess.run(
        ["powershell.exe", "-NoProfile", "-STA", "-EncodedCommand", encoded],
        capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=120,
    )
    if result.returncode != 0:
        raise OSError(result.stderr.strip() or "フォルダ選択が失敗しました。")
    return result.stdout.strip()


def call_codex(memos):
    env = os.environ.copy()
    env.pop("OPENAI_API_KEY", None)
    env.pop("CODEX_API_KEY", None)
    command = [
        str(find_codex()), "exec", "--ephemeral", "--sandbox", "read-only",
        "--ignore-user-config", "--ignore-rules", "--skip-git-repo-check",
        build_prompt(memos),
    ]
    try:
        result = subprocess.run(
            command, cwd=APP_DIR, env=env, capture_output=True, text=True,
            encoding="utf-8", errors="replace", timeout=180,
        )
    except subprocess.TimeoutExpired as error:
        raise CodexError("Codexの処理がタイムアウトしました。") from error
    if result.returncode != 0:
        detail = result.stderr.strip()
        if "not logged in" in detail.lower() or "login" in detail.lower():
            raise CodexError("Codex CLIにChatGPTでログインしてください。")
        raise CodexError(f"Codexの実行に失敗しました: {detail[-300:] or '不明なエラー'}")
    if not result.stdout.strip():
        raise CodexError("Codexから整理結果を取得できませんでした。")
    return result.stdout.strip()


def save_markdown(memos, summary):
    now = datetime.now()
    save_dir = get_save_dir()
    if not save_dir:
        raise OSError("保存先が設定されていません。")
    save_dir.mkdir(parents=True, exist_ok=True)
    path = save_dir / f"{now:%Y-%m-%d}.md"
    content = f"""---
date: {now:%Y-%m-%d}
created: {now.isoformat(timespec='seconds')}
tags:
  - daily-memo
---

# Daily Memo {now:%Y-%m-%d}

## 朝のメモ

{memos['morning'] or '（未入力）'}

## 昼のメモ

{memos['noon'] or '（未入力）'}

## 夜のメモ

{memos['night'] or '（未入力）'}

# AIによる整理

{summary}
"""
    path.write_text(content, encoding="utf-8")
    return path


def get_today_markdown():
    save_dir = get_save_dir()
    if not save_dir:
        return None, None
    path = save_dir / f"{datetime.now():%Y-%m-%d}.md"
    try:
        return path, path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return path, None


if __name__ == "__main__":
    print(f"Daily Memo: http://{HOST}:{PORT}/", flush=True)
    print(f"Markdown保存先: {get_save_dir() or '未設定'}", flush=True)
    (APP_DIR / ".daily-memo.pid").write_text(str(os.getpid()), encoding="ascii")
    try:
        server = LocalThreadingHTTPServer((HOST, PORT), DailyMemoHandler)
        print("Server ready", flush=True)
        threading.Timer(1.0, lambda: webbrowser.open(f"http://{HOST}:{PORT}/")).start()
        server.serve_forever()
    finally:
        (APP_DIR / ".daily-memo.pid").unlink(missing_ok=True)

#!/usr/bin/env python3
"""
Server local cho page đồng hồ mực điện tử.

  python3 server.py            # mở http://localhost:8765

- Phục vụ index.html (Web Bluetooth chỉ chạy trên https hoặc http://localhost).
- GET /data.json  → dữ liệu cho "Bảng thông tin":
    * claude : thống kê Claude Code đọc từ ~/.claude/projects/**/*.jsonl trên máy này
    * mọi khoá trong my-info.json (ghi chú, việc cần làm, … bạn tự sửa)
    * kết quả các hàm trong SOURCES bên dưới (thêm nguồn riêng của bạn ở đó)
"""
import json
import os
import sys
import time
from datetime import datetime, timedelta
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CLAUDE_PROJECTS = Path.home() / ".claude" / "projects"
MY_INFO = ROOT / "my-info.json"
PORT = int(os.environ.get("PORT", "8765"))
# Page public trên GitHub Pages được đọc /data.json khi mở trên chính máy này.
PUBLIC_ORIGIN = "https://taiituan13.github.io"


def load_my_info():
    try:
        return json.loads(MY_INFO.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}
    except json.JSONDecodeError as e:
        return {"note": f"my-info.json lỗi: {e.msg} dòng {e.lineno}"}


def claude_stats(budget_5h):
    """Đếm tin nhắn / token Claude Code hôm nay và trong 5 giờ gần nhất."""
    now = datetime.now().astimezone()
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    win_start = now - timedelta(hours=5)
    since = min(day_start, win_start).timestamp()

    seen = set()
    today = {"messages": 0, "output_tokens": 0, "input_tokens": 0, "cache_read_tokens": 0, "sessions": 0}
    window = {"messages": 0, "output_tokens": 0}
    sessions, models = set(), {}
    last = None

    files = CLAUDE_PROJECTS.glob("**/*.jsonl") if CLAUDE_PROJECTS.exists() else []
    for f in files:
        try:
            if f.stat().st_mtime < since:
                continue
            fh = f.open(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        with fh:
            for line in fh:
                if '"usage"' not in line:
                    continue
                try:
                    rec = json.loads(line)
                except ValueError:
                    continue
                msg = rec.get("message") or {}
                usage = msg.get("usage")
                mid = msg.get("id") or rec.get("requestId")
                if not usage or not mid or mid in seen:
                    continue
                seen.add(mid)
                try:
                    ts = datetime.fromisoformat(rec["timestamp"].replace("Z", "+00:00"))
                except (KeyError, ValueError):
                    continue
                out = usage.get("output_tokens", 0) or 0
                if ts >= day_start:
                    today["messages"] += 1
                    today["output_tokens"] += out
                    today["input_tokens"] += (usage.get("input_tokens", 0) or 0) + (usage.get("cache_creation_input_tokens", 0) or 0)
                    today["cache_read_tokens"] += usage.get("cache_read_input_tokens", 0) or 0
                    sessions.add(rec.get("sessionId"))
                    model = msg.get("model") or "?"
                    models[model] = models.get(model, 0) + 1
                if ts >= win_start:
                    window["messages"] += 1
                    window["output_tokens"] += out
                if last is None or ts > last:
                    last = ts

    today["sessions"] = len(sessions - {None})
    today["top_model"] = max(models, key=models.get) if models else None
    window["budget"] = budget_5h
    # "percent" so với ngân sách BẠN TỰ ĐẶT trong my-info.json, không phải hạn mức thật của gói.
    window["percent"] = round(100 * window["output_tokens"] / budget_5h) if budget_5h else 0
    return {"today": today, "window5h": window, "last_activity": last.isoformat() if last else None}


# Thêm nguồn dữ liệu riêng: mỗi hàm nhận my_info, trả về dict được gộp vào /data.json.
def source_claude(info):
    return {"claude": claude_stats(int(info.get("claude_5h_budget_output_tokens", 150000)))}


RATE_LIMITS = Path.home() / ".claude" / "epd-rate-limits.json"
WEEKDAYS = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"]


def source_claude_limits(info):
    """Hạn mức thật của gói (5 giờ / 7 ngày), do ~/.claude/epd-statusline.py lưu lại."""
    try:
        saved = json.loads(RATE_LIMITS.read_text(encoding="utf-8"))
    except (FileNotFoundError, ValueError):
        saved = {}
    limits = saved.get("rate_limits") or {}
    now = time.time()
    out = {}
    for key, with_day in (("five_hour", False), ("seven_day", True)):
        w = limits.get(key) or {}
        resets_at = w.get("resets_at")
        if not saved:
            out[key] = {"percent": 0, "resets": "chưa có", "known": False}
        elif not resets_at or resets_at <= now:
            # Cửa sổ đã qua mốc reset từ lần lưu cuối: mức dùng đã về 0.
            out[key] = {"percent": 0, "resets": "đã reset", "known": True}
        else:
            t = datetime.fromtimestamp(resets_at).astimezone()
            label = t.strftime("%H:%M")
            if with_day:
                label = f"{WEEKDAYS[t.weekday()]} {label}"
            out[key] = {"percent": round(w.get("used_percentage") or 0), "resets": label,
                        "resets_at": int(resets_at), "known": True}
    out["saved_at"] = (
        datetime.fromtimestamp(saved["saved_at"]).astimezone().isoformat(timespec="seconds")
        if saved.get("saved_at") else None
    )
    return {"claude_limits": out}


SOURCES = [source_claude, source_claude_limits]


def collect():
    info = load_my_info()
    data = dict(info)
    for fn in SOURCES:
        try:
            data.update(fn(info))
        except Exception as e:  # một nguồn lỗi không làm hỏng cả bảng
            data.setdefault("errors", []).append(f"{fn.__name__}: {e}")
    data["generated_at"] = datetime.now().astimezone().isoformat(timespec="seconds")
    return data


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(ROOT), **kw)

    def do_GET(self):
        if self.path.split("?")[0] == "/data.json":
            t0 = time.time()
            body = json.dumps(collect(), ensure_ascii=False, indent=2).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self._cors()
            self.end_headers()
            self.wfile.write(body)
            self.log_message("data.json %.0f ms", (time.time() - t0) * 1000)
            return
        super().do_GET()

    def _cors(self):
        if self.headers.get("Origin") == PUBLIC_ORIGIN:
            self.send_header("Access-Control-Allow-Origin", PUBLIC_ORIGIN)
            self.send_header("Access-Control-Allow-Private-Network", "true")
            self.send_header("Vary", "Origin")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header("Access-Control-Allow-Methods", "GET")
        self.end_headers()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--dump":
        print(json.dumps(collect(), ensure_ascii=False, indent=2))
        sys.exit(0)
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Mở http://localhost:{PORT} bằng Chrome/Edge  (Ctrl+C để dừng)")
    srv.serve_forever()

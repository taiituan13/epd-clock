#!/usr/bin/env python3
"""
Status line cho Claude Code: in một dòng trạng thái và lưu hạn mức thật
(rate_limits 5 giờ / 7 ngày) vào ~/.claude/epd-rate-limits.json để page
đồng hồ mực điện tử đọc qua /data.json.
"""
import json
import os
import sys
import time
from pathlib import Path

CACHE = Path.home() / ".claude" / "epd-rate-limits.json"


def main():
    try:
        data = json.load(sys.stdin)
    except ValueError:
        data = {}

    limits = data.get("rate_limits") or {}
    if limits:
        out = {"rate_limits": limits, "saved_at": int(time.time())}
        tmp = CACHE.with_suffix(".tmp")
        try:
            tmp.write_text(json.dumps(out), encoding="utf-8")
            os.replace(tmp, CACHE)
        except OSError:
            pass

    parts = []
    model = (data.get("model") or {}).get("display_name")
    if model:
        parts.append(model)
    for key, label in (("five_hour", "5h"), ("seven_day", "7d")):
        w = limits.get(key)
        if w and w.get("used_percentage") is not None:
            parts.append(f"{label} {round(w['used_percentage'])}%")
    print(" · ".join(parts))


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
Lưu hạn mức gói Claude (từ tool get_usage của app desktop) vào
~/.claude/epd-rate-limits.json, cùng định dạng epd-statusline.py ghi ra,
để page đồng hồ mực điện tử đọc qua /data.json.

  echo '<JSON của get_usage>' | python3 ~/.claude/epd-save-limits.py

Nhận cả kết quả đầy đủ ({"plan": {...}}) lẫn riêng phần "plan".
"""
import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path

CACHE = Path.home() / ".claude" / "epd-rate-limits.json"


def key_for(label):
    label = label.lower()
    if label.startswith("5-hour"):
        return "five_hour"
    if label.startswith("weekly") and "all models" in label:
        return "seven_day"
    return None


def main():
    data = json.load(sys.stdin)
    plan = data.get("plan", data)
    if plan.get("status") != "ok":
        sys.exit(f"get_usage không có số: {plan.get('status')} {plan.get('note', '')}")

    limits = {}
    for w in plan.get("windows") or []:
        key = key_for(w.get("label", ""))
        if not key:
            continue
        resets = datetime.fromisoformat(w["resetsAt"].replace("Z", "+00:00")).timestamp()
        limits[key] = {"used_percentage": w.get("percentUsed", 0), "resets_at": int(resets)}
    if not limits:
        sys.exit("get_usage không có cửa sổ 5 giờ / tuần")

    out = {"rate_limits": limits, "saved_at": int(time.time()), "source": "desktop-app get_usage"}
    tmp = CACHE.with_suffix(".tmp")
    tmp.write_text(json.dumps(out), encoding="utf-8")
    os.replace(tmp, CACHE)
    print(" · ".join(f"{k} {v['used_percentage']}%" for k, v in limits.items()))


if __name__ == "__main__":
    main()

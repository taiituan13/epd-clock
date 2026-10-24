# Đồng hồ mực điện tử – bản local

Tái hiện cách kết nối của https://tanhoangphuc842002-rgb.github.io/ và thêm **Bảng thông tin**: hiển thị dữ liệu riêng của bạn (ví dụ thống kê Claude Code) lên đồng hồ.

## Bản public (điện thoại)

https://taiituan13.github.io/epd-clock/ — mở bằng Chrome trên Android, hoặc app **Bluefy** trên iPhone, rồi dùng như bản local.

- Bản public không có `server.py`, nên không có số liệu Claude của máy. Tab Bảng thông tin mặc định dùng **Dán JSON**: sửa JSON trong ô đó.
- Mẫu, chữ, lề… lưu riêng trên từng thiết bị (localStorage).
- Mở bản public trên chính máy đang chạy `server.py` thì có thể đặt URL dữ liệu là `http://localhost:8765/data.json`. Chrome có thể hỏi quyền truy cập mạng nội bộ.

## Chạy

```bash
python3 server.py
```

Mở `http://localhost:8765` bằng **Chrome/Edge** (máy tính, Android). Trên iPhone dùng app **Bluefy**.
Web Bluetooth chỉ chạy trên `https://` hoặc `http://localhost`, không chạy khi mở file trực tiếp.

## File

| File | Vai trò |
|---|---|
| `ble.js` | Giao thức BLE: quét, kết nối, cài giờ, đổi chế độ, gửi ảnh (nRF52 + DA14585) |
| `designer.js` | Vẽ nội dung, chuyển về 2–3 màu, cú pháp mẫu bảng thông tin |
| `app.js` | Nối giao diện |
| `server.py` | Phục vụ page + `/data.json` (thống kê Claude Code + `my-info.json`) |
| `my-info.json` | Thông tin riêng: ghi chú, việc cần làm, ngân sách token… |

## Giao thức (tóm tắt)

**nRF52** – tên `NRF_EPD…`, service `62750001-d828-918d-fb46-b6c11c675aec`, ghi/notify vào char `62750002-…`, đọc firmware ở `62750003-…`.

| Lệnh | Gói |
|---|---|
| INIT | `01` |
| REFRESH | `05` |
| Cài giờ + chế độ | `20 <unix 4 byte BE> <múi giờ> <mode>` (mode 1 = lịch, 2 = đồng hồ, 0 = ảnh; `|0x40` giữ mặt lịch) |
| Đầu tuần | `21 <0 = CN, 1 = T2>` |
| Ghi ảnh | `30 <00 nếu gói đầu, F0 nếu gói sau | 0F lớp đen / 00 lớp đỏ> <dữ liệu>` |

Notify: gói cấu hình (byte 7 = model, 11 = mode, 13 = panel 0x21/0x29), `mtu=…`, `v=<mV>` (pin), `t=…` (INIT xong).

**DA14585** – tên `DLG-CLOCK…`, lệnh vào service `1F10` / char `1F1F`; ảnh vào service `13187b10-…` / char `4b646063-…`.

| Lệnh | Gói |
|---|---|
| Cài giờ | `dd <unix 4B> <năm 2B> <tháng> <ngày> <thứ>` rồi `e2` |
| Chế độ | `e1 01` lịch / `e1 02` đồng hồ, rồi `e2`; `e1 00` ảnh |
| Kích thước ảnh | `8f <w 2B> <h 2B>` |
| Ghi ảnh | `03 <ff đen / 00 đỏ> <offset 2B> <16 byte>`, xong gửi `01` |

## Thêm dữ liệu riêng

1. Sửa `my-info.json`: mọi khoá trong đó dùng được trong mẫu, ví dụ `{{note}}`, `{{todo.0}}`.
2. Hoặc thêm hàm vào `SOURCES` trong `server.py`: mỗi hàm trả về một `dict`, được gộp vào `/data.json`.
3. Trong tab **Bảng thông tin**, sửa mẫu rồi bật **Tự động cập nhật**. Page chỉ gửi khi ảnh thay đổi, để tiết kiệm pin.

### Hạn mức thật của gói Claude (5 giờ / 7 ngày)

Claude Code chỉ đưa số này cho script **status line**. `~/.claude/epd-statusline.py` nhận số đó, in dòng trạng thái và lưu vào `~/.claude/epd-rate-limits.json`; server đọc file này thành:

- `{{claude_limits.five_hour.percent}}`, `{{claude_limits.five_hour.resets}}` (giờ reset)
- `{{claude_limits.seven_day.percent}}`, `{{claude_limits.seven_day.resets}}` (thứ + giờ reset)

Bật bằng cách thêm vào `~/.claude/settings.json`:

```json
"statusLine": { "type": "command", "command": "python3 ~/.claude/epd-statusline.py" }
```

Số chỉ được cập nhật khi đang có một phiên Claude Code chạy trong terminal (status line chạy sau mỗi tin nhắn). Khi chưa có file, mẫu hiện `chưa có`.

**Chỉ dùng app desktop?** Status line không chạy trong app. Thay vào đó, tạo một **Scheduled task** trong app (lịch `*/30 * * * *`, prompt lấy từ `scheduled-task-prompt.md`). Mỗi lần chạy, task gọi tool `get_usage` của app rồi chuyển kết quả cho `~/.claude/epd-save-limits.py`, script này ghi vào cùng file `epd-rate-limits.json`. Task chỉ chạy khi app đang mở, và mỗi lần chạy tốn một chút hạn mức.

`claude.window5h.percent` thì khác: tính theo ngân sách **bạn tự đặt** (`claude_5h_budget_output_tokens`).

Lưu ý: gửi ảnh sẽ chuyển đồng hồ sang chế độ ảnh. Bấm **Đồng hồ** hoặc **Lịch** để quay lại.

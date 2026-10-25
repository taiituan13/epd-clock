# Đồng hồ mực điện tử (epd-clock) — hướng dẫn cho AI

Page điều khiển đồng hồ mực điện tử qua Web Bluetooth. Page tái hiện giao thức của trang hãng
(https://tanhoangphuc842002-rgb.github.io/) và thêm **Bảng thông tin** để đưa dữ liệu riêng, như
mức dùng Claude, lên màn. Dự án cá nhân, không thuộc nhóm UrbanB.

- Người dùng đọc tiếng Việt: trả lời, giao diện page, ghi chú trong code đều viết tiếng Việt.
- **Chữ hiện trên màn đồng hồ thì dùng tiếng Anh**, vì dấu tiếng Việt vỡ ở cỡ chữ nhỏ (người dùng đã chọn).
- Giao thức BLE, cú pháp mẫu, cách chạy cho người: `README.md`. Firmware: `docs/firmware.md`.

## Hiện trạng (25/10/2026)

- **Repo**: https://github.com/taiituan13/epd-clock (public). **Page public**: https://taiituan13.github.io/epd-clock/ (GitHub Pages, nhánh `main`, thư mục gốc).
- **Máy của người dùng**: chip nRF52, màn 2.13" ba màu đen/trắng/đỏ, profile `nrf52_2.13`, vẽ 250×128. Viền máy che mép dưới, nên lề dưới mặc định 10px (đã đo: hàng mực cuối là 113/128).
- **Đã chạy**:
  - gửi ảnh, đổi chế độ đồng hồ/lịch, cài giờ;
  - bảng thông tin theo mẫu, mẫu mặc định `claude_en`, tự cập nhật theo phút (chỉ gửi khi ảnh đổi);
  - tự kết nối lại khi mất kết nối (2→5→15→30→60 giây, trừ khi người dùng bấm Ngắt);
  - icon `[icon:claude]` (ngôi sao tia, màu đỏ);
  - hạn mức Claude thật (5 giờ / tuần) qua scheduled task, xem bên dưới.
- **Lớp đỏ màn 2.13"**: luôn gửi cả hai lớp. Máy của người dùng báo model khác 2; trước đây page chỉ gửi lớp đen, RAM đỏ giữ rác nên hiện hạt đỏ khắp màn (đã sửa 25/10, người dùng xác nhận sạch). Log khi gửi ghi model/panel.
- **iPhone**: Chrome/Safari trên iOS không có Web Bluetooth, chỉ chạy qua app **Bluefy**. `write()` trong `ble.js` tự dùng `writeValue` khi trình duyệt thiếu `writeValueWithResponse`. Chưa thử với Bluefy thật.
- **Mẫu decor**: 6 mẫu thiết kế (Claude Spark, tuần trăng, vòng hạn mức, bonsai pixel, sóng Seigaiha, câu nhắc) nằm trên canvas Claude Design https://claude.ai/artifact/SybiphRJqKm43eyAvwFB5a (riêng tư). **Chưa mẫu nào được đưa vào page.** Bản sao mã nguồn các mẫu: `docs/decor/*.dc.html` (vẽ ở 1000×488 = 4× màn).

## Bản đồ tệp

| Tệp | Vai trò |
|---|---|
| `index.html`, `styles.css` | Giao diện. CSS/JS nạp kèm `?v=N`. |
| `ble.js` | `EpdClock`: quét, kết nối, tự kết nối lại, lệnh nRF52 / DA14585, gửi ảnh; `PROFILES` các cỡ màn. |
| `designer.js` | Vẽ bảng thông tin (`drawDashboard`, cú pháp dòng ở chú thích đầu hàm), icon, `quantize` (chế độ `crisp` cho chữ), `FORMATS` (`num`, `k`, `pct`, `hm`, `dayhm`…). |
| `app.js` | Nối giao diện: `PRESETS`, `SAMPLE_JSON`, nguồn dữ liệu (URL hoặc dán JSON), tự cập nhật, upload. Trạng thái lưu localStorage khoá `epd.*`. |
| `server.py` | Phục vụ page + `/data.json` = `my-info.json` + thống kê Claude Code (đọc `~/.claude/projects/**/*.jsonl`) + `claude_limits`. `SOURCES` là chỗ thêm nguồn. CORS chỉ cho `PUBLIC_ORIGIN`. |
| `my-info.json` | Ghi chú, việc cần làm, ngân sách token tự đặt. Repo public: không ghi gì riêng tư vào đây. |
| `tools/` | Bản lưu của các script chạy ngoài repo (bên dưới) và prompt của scheduled task. |
| `.claude/launch.json` | Cấu hình preview `epd-clock`: `python3 server.py`, cổng 8765. |

## Phần nằm ngoài repo (đừng quên khi sửa)

- `~/.claude/epd-save-limits.py`: bản **đang chạy**; `tools/epd-save-limits.py` là bản lưu. Sửa thì chép lại cả hai chỗ. Script nhận JSON của tool `get_usage` và ghi `~/.claude/epd-rate-limits.json`.
- `~/.claude/epd-statusline.py` (bản lưu ở `tools/`): ghi cùng file cache từ status line. **Chưa bật**: không có `statusLine` trong `~/.claude/settings.json`. Auto mode chặn việc sửa settings, và người dùng chỉ dùng app desktop, nơi status line không chạy.
- **Scheduled task `epd-claude-limits`** trong app desktop: chạy `*/30 * * * *` ở Auto mode, gọi `get_usage` rồi chạy `epd-save-limits.py`. Tệp task: `~/.claude/scheduled-tasks/epd-claude-limits/SKILL.md`. Task chỉ chạy khi app mở, và tốn một chút hạn mức mỗi lần.
- CLI `claude` trên máy **chưa đăng nhập**, nên mọi cách lấy số qua `claude -p` đều không dùng được.

## Chạy và kiểm tra

- Chạy: `python3 server.py`, rồi mở http://localhost:8765. Xem dữ liệu: `python3 server.py --dump`.
- Kiểm cú pháp: `node --check ble.js designer.js app.js` (từng tệp) và `python3 -m py_compile server.py`.
- Xem ảnh sẽ gửi: trong preview, chọn mẫu, bấm **Lấy dữ liệu**, rồi phóng to canvas `#preview` (vẽ lại ×4–×8, tắt `imageSmoothing`) để soi từng pixel.
- **Trình duyệt preview không có Bluetooth**, nên không thử được với đồng hồ thật. Logic BLE thì kiểm bằng `navigator.bluetooth` giả lập trong Node. Thứ gì cần máy thật thì nói rõ là chưa kiểm và nhờ người dùng thử.

## Luật khi sửa

- **Mỗi lần sửa CSS/JS phải tăng `?v=N`** trong `index.html`. GitHub Pages cache 10 phút, nên điện thoại sẽ giữ bản cũ nếu quên.
- Màn chỉ có đen, trắng, đỏ (không có xám). Chữ dùng weight ≥ 600. Bảng thông tin quantize ở chế độ `crisp` khi tắt Dither. Chữ dưới khoảng 10px thật sẽ vỡ.
- Ở chế độ ảnh, đồng hồ **không tự chạy giờ**: đừng vẽ giờ hiện tại lên ảnh, chỉ vẽ ngày hoặc giờ reset.
- Không đọc keychain/OAuth và không gọi endpoint usage không công khai bằng token của người dùng. Không tự sửa `~/.claude/settings.json`.
- Push, đổi Pages, tạo hay sửa scheduled task, công khai dữ liệu: mỗi việc hỏi người dùng một lần (lần push đầu đã được duyệt, các lần sau vẫn hỏi).
- Commit kết thúc bằng `Co-Authored-By: Claude …`.

## Việc còn treo (người dùng chưa chốt)

- Đưa mẫu decor vào page. Hai mẫu hợp nhất: tuần trăng (tính theo ngày) và vòng hạn mức (dữ liệu thật). Cách làm: thêm vào `designer.js` thành cú pháp mới hoặc chế độ vẽ riêng.
- Icon đổi tư thế mỗi lần cập nhật: đã đề xuất, chưa làm. Đánh đổi là mỗi lượt cập nhật sẽ làm mới màn.
- Số Claude thật trên điện thoại: muốn có thì phải đẩy `data.json` công khai (ví dụ commit 30 phút một lần). Chưa chốt vì lộ số liệu.
- Firmware tự viết: chưa làm; đã nghiên cứu xong, xem `docs/firmware.md`.

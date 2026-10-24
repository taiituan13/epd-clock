# Firmware: đã tìm hiểu được gì (24–25/10/2026)

## Firmware gốc của hãng

- Cập nhật OTA qua Nordic Secure DFU: service `fe59`, characteristic `8ec90001/2/3`.
- Gói firmware có chữ ký ECDSA P-256 và được mã hoá (descriptor "DHE1", model id `0x0211`/`0x0212`/`0x0291`/`0x0292`). Bản 2.13" còn có bước kích hoạt riêng.
- Vì vậy **OTA chỉ nhận gói do hãng ký**: không nạp firmware tự viết qua Bluetooth được.

## Đường duy nhất: nạp qua SWD

- Mã nguồn mở để dựa vào: **tsl0922/EPD-nRF5** (GPL-3.0). Hỗ trợ nRF51822/51802/52810/52811. Có project bootloader DFU `Keil/DFU-nRF52.uvprojx`.
- Trình tự nạp: xoá toàn bộ chip → nạp SoftDevice → nạp ứng dụng.
- **Mất firmware gốc vĩnh viễn**. Firmware gốc gần như chắc chắn đã bật APPROTECT, nên không đọc ra để sao lưu được.
- **Mạch nạp**:
  - dùng **DAPLink (CMSIS-DAP)** hoặc **J-Link**: hai loại này làm được bước recover / mass erase khi chip đã khoá;
  - ST-Link clone thường không mở khoá được nRF52.
- **Nối dây**: `SWDIO`, `SWCLK`, `GND`, `VCC`/`VTref` 3.3V (không bao giờ 5V; tháo pin nếu cấp điện từ mạch nạp). nRF52 không cần dây RESET.
  - Bo mạch thường chỉ có test pad, không có chân cắm.
  - Có thể dùng kẹp pogo pin (không hàn) hoặc hàn dây mảnh (chắc nhất).
- **Bước tiếp theo khi làm**: mở máy, chụp hai mặt bo mạch để tìm pad SWD, đọc mã chip và controller màn, rồi đối chiếu với các cấu hình mà EPD-nRF5 hỗ trợ.

## Firmware tự viết làm thêm được gì

- Đồng hồ tự vẽ mặt (giờ chạy từng phút, icon, tuần trăng tính ngay trên máy). Điện thoại chỉ gửi vài byte số liệu thay vì cả ảnh khoảng 8 KB.
- Lưu vài ảnh trong flash rồi tự đổi (nRF52810: 192 KB flash, 24 KB RAM).
- Tự chỉnh LUT để vùng đen/trắng làm mới nhanh khoảng 1–2 giây. Lớp đỏ vẫn chậm, và LUT sai dễ để lại bóng mờ.
- Tự chỉnh quảng bá Bluetooth, chu kỳ kết nối và lúc ngủ (liên quan lỗi hay mất kết nối).
- Giới hạn cứng: chỉ ba màu, không có Wi-Fi, không chạy hình động mượt được.

Các script OTA tải từ trang hãng trong lúc tìm hiểu **không** đưa vào repo (bản quyền của hãng). Cần thì tải lại từ trang đó.

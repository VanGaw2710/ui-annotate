# UI Annotate

Chrome Extension ghi chú QC giao diện. Alt + click vào element bất kỳ trên bất kỳ website
nào, lái vùng chọn bằng phím mũi tên, ghi chú, rồi xuất **một file Markdown cho toàn bộ
website** để đưa cho Dev hoặc dán thẳng vào một agent viết code.

Không build, không dependency, không gửi dữ liệu ra ngoài. Load unpacked là chạy.

## Bản đang phát triển

**[`ui-annotate-extension-v2.2/`](ui-annotate-extension-v2.2/)** — đây là bản đang dùng.
Hướng dẫn đầy đủ nằm trong [README của thư mục đó](ui-annotate-extension-v2.2/README.md).

> **Tên thư mục là `v2.2` nhưng `manifest.json` đã là `2.4.0`.** Thư mục được đặt tên lúc
> tách nhánh khỏi v2.0 và giữ nguyên từ đó; version thật luôn đọc ở `manifest.json`.

## Các thư mục khác

| Thư mục | Là gì |
|---|---|
| [`ui-annotate-extension/`](ui-annotate-extension/) | v2.0.0, giữ nguyên làm bản đối chiếu |
| [`achieved/src-v2.0.0/`](achieved/src-v2.0.0/) | Bản đóng băng của v2.0.0 |
| [`achieved/src-v2.1.0/`](achieved/src-v2.1.0/) | v2.1.0 — hướng chụp ảnh element + xuất .zip, **đã bỏ** |
| `achieved/*.zip` | Gói đóng sẵn của v2.0.0 và v2.1.0 |

v2.1.0 không phải tiền thân của bản hiện tại. Nhánh đó đi theo hướng chụp ảnh từng element
rồi đóng gói `.zip`, bị bỏ hẳn vì quá nặng so với giá trị mang lại. Bản hiện tại nối tiếp
thẳng từ v2.0.0.

## Lịch sử tính năng

| Version | Thay đổi chính |
|---|---|
| 2.0.0 | Chuyển từ script nhúng sang extension; note gom theo origin trong `chrome.storage` |
| 2.2.x | Điều hướng bằng phím mũi tên; output .md viết lại cho agent đọc, gọn hơn ~50% |
| 2.3.0 | Bắt tên React component qua `react-probe.js` chạy ở world `MAIN` |
| 2.4.0 | Sửa ghi chú đã lưu (nút `✎`); `Esc` đóng theo từng nấc |

## Cài

1. Mở `chrome://extensions`, bật **Developer mode**
2. **Load unpacked** → chọn `ui-annotate-extension-v2.2/`
3. Tải lại (F5) các tab đang mở sẵn

Tắt bản v2.0 trước nếu đang bật — hai extension chạy ở hai isolated world riêng nên biến
chặn nạp trùng không thấy nhau, bật cả hai là màn hình có hai overlay chồng lên nhau.

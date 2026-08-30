# UI Annotate — Chrome Extension ghi chú QC UI / Userflow

Alt + click bất kỳ element nào **trên bất kỳ website nào** → ghi chú → xuất **một file
Markdown duy nhất cho toàn bộ đường dẫn của site đó** gửi Dev.

Bản này thay cho `annotate.js` cũ (phải nhúng vào `public/` của project Next.js và lưu
note tách rời theo từng `pathname`).

| | `annotate.js` cũ | Extension này |
|---|---|---|
| Phạm vi | Chỉ project mình nhúng code | Mọi website, không đụng source |
| Nơi lưu | `localStorage`, **tách riêng từng pathname** | `chrome.storage`, **gom theo origin** |
| Chuyển trang | Mất danh sách, phải copy từng trang | Note còn nguyên, cộng dồn |
| Export | Mỗi trang một file | **Một file .md cho cả site**, chia mục theo từng trang |
| CSS của site đè lên overlay | Có thể | Không — overlay nằm trong Shadow DOM |
| Dữ liệu bắt được | selector, class, text, kích thước | thêm **computed style** (font, màu, spacing, radius…) |

---

## 1. Cài đặt (2 phút, không cần build)

1. Mở `chrome://extensions`
2. Bật **Developer mode** (góc trên bên phải)
3. Bấm **Load unpacked** → chọn thư mục `ui-annotate-extension`
4. Ghim icon extension lên thanh công cụ cho tiện

Xong. Mở lại (F5) các tab đang mở sẵn — content script chỉ tự chèn vào trang được tải sau
khi cài.

> Chrome sẽ nhắc "extension này có thể đọc dữ liệu trên mọi trang bạn truy cập". Đúng —
> extension phải đọc DOM thì mới soi element được. Nó **không gửi gì ra ngoài**: không có
> network request nào, dữ liệu chỉ nằm trong `chrome.storage.local` của máy bạn.

---

## 2. Dùng

### Phím tắt

| Phím | Việc |
|---|---|
| Giữ `Alt` | Bật chế độ soi element (viền xanh + kích thước) |
| `Alt` + click | Chọn element và mở ô ghi chú |
| `Cmd/Ctrl` + `Enter` | Lưu ghi chú đang gõ |
| `Esc` | Thoát soi / đóng panel / huỷ ô ghi chú |
| `Alt` + `Shift` + `A` | Mở / đóng panel danh sách |
| `Alt` + `Shift` + `H` | Tắt / bật toàn bộ overlay (nhớ qua reload, dùng chung mọi site) |

### Vòng làm việc QC

1. Mở site cần QC, đi qua từng màn hình trong userflow.
2. Thấy chỗ sai → `Alt` + click → gõ nội dung → chọn loại (**UI / Nội dung / Userflow /
   Bug**) → `Cmd+Enter`.
3. Chuyển trang thoải mái. Số trên nút tròn góc phải là **tổng ghi chú của cả site**.
4. Xong: mở panel → tab **Toàn site** → **Copy .md** hoặc **Tải .md**.
   (Hoặc bấm icon extension trên thanh công cụ → **Copy .md toàn site**.)
5. Dán vào Slack/Jira cho Dev, hoặc quăng file cho Claude Code sửa thẳng.

Panel có 2 tab:
- **Trang này** — chỉ ghi chú của URL đang mở; hover vào item để highlight lại element,
  click để cuộn tới nó.
- **Toàn site** — mọi ghi chú, gom theo từng đường dẫn; click item ở trang khác sẽ điều
  hướng sang đúng URL đó.

---

## 3. File Markdown xuất ra

Một file cho cả site, mở đầu bằng mục lục các trang, rồi từng ghi chú:

```markdown
# UI QC — https://app.example.com
12 ghi chú · 4 trang · xuất lúc 14/08/2026 16:20

## Mục lục
1. `/checkout` — 5 ghi chú
2. `/cart` — 3 ghi chú
…

## `/checkout` — 5 ghi chú
URL: https://app.example.com/checkout

### 1. [UI] <button.btn-primary> — Nút này phải cao 48px theo design
- **Selector:** `main > form > button:nth-of-type(2)`
- **Class:** `btn btn-primary w-full`
- **Text:** "Thanh toán"
- **Kích thước:** 320×40px · viewport 1440px
- **Computed style:**
  - Chữ: `font-size: 14px` · `font-weight: 600` · `line-height: 20px`
  - Màu: `color: rgb(255, 255, 255)` · `background-color: rgb(37, 99, 235)` · `border-radius: 8px`
  - Hộp: `display: flex` · `height: 40px` · `padding: 10px 16px`

```html
<button class="btn btn-primary w-full" type="submit">
```
```

`Computed style` là giá trị **đang chạy thật** trên trình duyệt lúc ghi chú — Dev không
phải hỏi lại "đang bao nhiêu px", so thẳng với Figma là ra.

---

## 4. Phạm vi lưu & quyền riêng tư

- Ghi chú gom **theo origin**: `https://app.example.com` và `https://staging.example.com`
  là hai kho riêng — không lẫn môi trường.
- Dữ liệu nằm trong `chrome.storage.local`, chỉ máy bạn đọc được, không đồng bộ lên tài
  khoản Google, không gửi đi đâu.
- Popup liệt kê các site khác đang có ghi chú, bấm là copy .md của site đó — không cần mở
  lại site.
- Xoá: panel → **Xoá hết**, hoặc popup → **Xoá hết** (chỉ xoá site hiện tại).

---

## 5. Giới hạn đã biết

- **Trang nội bộ của Chrome** (`chrome://`, Web Store, `file://` khi chưa bật quyền) không
  chèn được content script — giới hạn của trình duyệt, không sửa được.
- **iframe**: hiện chỉ chạy ở frame chính. Nếu cần ghi chú bên trong iframe (payment
  widget, embed), đổi `"all_frames": false` → `true` trong `manifest.json`.
- **Selector sau khi SPA render lại**: `nth-of-type` có thể lệch nếu DOM đổi cấu trúc.
  File .md luôn kèm `Text` và `Class` để tìm bù.
- **Tên React component**: bản này *không* bắt. Content script chạy ở isolated world nên
  không đọc được `__reactFiber$` của trang; muốn có phải thêm một script chạy ở
  `world: "MAIN"` bắc cầu qua `postMessage`. Với site production đã minify thì field này
  gần như luôn rỗng, nên tạm bỏ. Cần bật lại thì báo — thêm một file là xong.
- **Ảnh chụp element**: chưa có. Đã bàn phương án crop đúng vùng element kèm vào .md —
  cần thêm quyền chụp tab và xử lý crop, để dành khi Dev thật sự cần nhìn ảnh.

---

## 6. Cấu trúc file

```
ui-annotate-extension/
├── manifest.json    khai báo extension (MV3)
├── content.js       overlay: soi element, ô ghi chú, panel — chạy trên mọi trang
├── shared.js        kho dữ liệu + bộ sinh Markdown (dùng chung content & popup)
├── background.js    service worker: hiện số ghi chú lên badge icon
├── popup.html/js    bảng điều khiển khi bấm icon
└── icons/           icon 16/32/48/128
```

# UI Annotate — Chrome Extension ghi chú QC UI / Userflow

**v2.1.0** — Alt + click bất kỳ element nào **trên bất kỳ website nào** → ghi chú **kèm ảnh
chụp đúng vùng element** → xuất **một gói duy nhất cho toàn bộ đường dẫn của site đó** gửi Dev.

> Đổi so với v2.0.0: mỗi ghi chú tự kèm ảnh crop của element (bật/tắt được trong popup), và
> nút tải xuất ra `.zip` gồm `report.md` + thư mục `anh/` khi có ảnh. Bản v2.0.0 vẫn nằm ở
> `../releases/` nếu cần quay lại.

Bản này thay cho `annotate.js` cũ (phải nhúng vào `public/` của project Next.js và lưu
note tách rời theo từng `pathname`).

| | `annotate.js` cũ | Extension này |
|---|---|---|
| Phạm vi | Chỉ project mình nhúng code | Mọi website, không đụng source |
| Nơi lưu | `localStorage`, **tách riêng từng pathname** | `chrome.storage`, **gom theo origin** |
| Chuyển trang | Mất danh sách, phải copy từng trang | Note còn nguyên, cộng dồn |
| Export | Mỗi trang một file | **Một file .md cho cả site**, chia mục theo từng trang |
| CSS của site đè lên overlay | Có thể | Không — overlay nằm trong Shadow DOM |
| Dữ liệu bắt được | selector, class, text, kích thước | thêm **computed style** (font, màu, spacing, radius…) và **ảnh chụp element** |

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
   Bug**) → `Cmd+Enter`. Ảnh element được chụp **ngay lúc click**, chừa 8px viền quanh để Dev
   thấy ngữ cảnh; overlay tự ẩn nên không lọt vào ảnh.
3. Chuyển trang thoải mái. Số trên nút tròn góc phải là **tổng ghi chú của cả site**.
4. Xong: mở panel → tab **Toàn site** → **Copy .md** (text, dán Slack/Jira) hoặc **Tải .zip**
   (`report.md` + thư mục `anh/`). Không có ảnh thì nút tự đổi thành **Tải .md**.
   (Hoặc bấm icon extension trên thanh công cụ → **Copy .md toàn site**.)
5. Gửi Dev, hoặc giải nén rồi quăng cả thư mục cho Claude Code sửa thẳng.

Panel có 2 tab:
- **Trang này** — chỉ ghi chú của URL đang mở; hover vào item để highlight lại element,
  click để cuộn tới nó.
- **Toàn site** — mọi ghi chú, gom theo từng đường dẫn; click item ở trang khác sẽ điều
  hướng sang đúng URL đó.

---

## 3. File xuất ra

Có ảnh → `.zip`:

```
ui-qc-app.example.com-20260815.zip
├── report.md
└── anh/
    ├── 01-button.webp
    ├── 02-p.webp
    └── 03-h1.webp
```

Ảnh đánh số đúng theo thứ tự mục trong `report.md`, định dạng WebP (nhẹ hơn PNG ~4 lần ở cùng
chất lượng), bề rộng tối đa 1200px. Ảnh **không** nhúng base64 vào `.md` vì file sẽ phình vài
MB và nhiều trình đọc markdown chặn ảnh dạng `data:` URI.

`report.md` — một file cho cả site, mở đầu bằng mục lục các trang, rồi từng ghi chú:

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
- **Ảnh chụp:**

  ![Nút này phải cao 48px theo design](anh/01-button.webp)

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
- Ảnh chụp cũng nằm trong `chrome.storage.local` cùng ghi chú, **không** upload đi đâu.
  Extension khai báo `unlimitedStorage` để ảnh không đụng trần 10MB mặc định; popup hiện dung
  lượng đang dùng của site để bạn biết khi nào nên xoá.
- Không muốn ảnh: popup → bỏ tick **Chụp ảnh element kèm ghi chú**. Ghi chú cũ giữ nguyên ảnh
  đã có, chỉ ghi chú mới là không kèm.

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
- **Ảnh chụp chỉ có phần đang thấy trên màn hình**: `captureVisibleTab` của Chrome chụp khung
  nhìn, không chụp cả trang. Element cao hơn màn hình → ảnh bị cắt, `report.md` ghi rõ *"element
  vượt khung nhìn"* ở mục đó. Muốn ảnh đủ thì cuộn cho element vào giữa màn hình rồi mới
  `Alt` + click, hoặc thu nhỏ zoom trình duyệt.
- **Chụp nhanh liên tục**: Chrome giới hạn số lần chụp mỗi giây. Ghi chú vẫn lưu bình thường,
  chỉ là note đó không có ảnh — toast báo "Đã lưu" thay vì "Đã lưu kèm ảnh".
- **Ảnh làm dữ liệu nặng lên**: mỗi ảnh cỡ 20–100KB. QC một site vài chục ghi chú là vài MB.
  Thấy popup báo dung lượng lớn thì tải `.zip` về rồi **Xoá hết**.

---

## 6. Cấu trúc file

```
ui-annotate-extension/
├── manifest.json    khai báo extension (MV3)
├── content.js       overlay: soi element, chụp + crop ảnh, ô ghi chú, panel
├── shared.js        kho dữ liệu + bộ sinh Markdown + đóng gói .zip
├── zip.js           bộ ghi file ZIP tối giản, thuần JS, không thư viện ngoài
├── background.js    service worker: chụp tab hộ content script + badge số ghi chú
├── popup.html/js    bảng điều khiển khi bấm icon
└── icons/           icon 16/32/48/128
```

Luồng chụp ảnh: content script không gọi được `chrome.tabs.captureVisibleTab`, nên nó nhờ
`background.js` chụp khung nhìn, rồi tự crop đúng `getBoundingClientRect()` của element bằng
canvas. Tỉ lệ crop suy từ chính ảnh nhận về (`img.width / window.innerWidth`) thay vì tin
`devicePixelRatio` — zoom trang hoặc cắm màn ngoài giữa chừng vẫn crop đúng.

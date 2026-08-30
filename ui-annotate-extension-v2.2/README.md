# UI Annotate v2.4 — Chrome Extension ghi chú QC UI / Userflow

Alt + click bất kỳ element nào **trên bất kỳ website nào** → chỉnh vùng chọn bằng **phím
mũi tên** → ghi chú → xuất **một file Markdown cho toàn bộ đường dẫn của site đó**.

> **Người đọc file này là Claude Code, không phải người.** Toàn bộ định dạng xuất ra ở
> v2.2 được viết lại theo hướng đó: bỏ mục lục / hướng dẫn cách đọc / viewport, dồn chỗ
> cho `class` + `attr` (thứ grep ra được component trong source) và chỉ in phần CSS liên
> quan tới điều đang than phiền.

## Đổi so với v2.0.0

| | v2.0.0 | v2.4.0 |
|---|---|---|
| Chọn element | Chỉ Alt + click, trúng đâu chịu đó | Thêm **↑↓←→** để ra thẻ bọc / vào thẻ con / lướt anh em |
| Nhắc phím tắt | Không có | Dấu **`?`** trong ô ghi chú, hover ra bảng đủ 10 phím |
| Kích thước màn hình | `viewport 1440px` | `màn hình 1512×982 (xl)` — kèm breakpoint Tailwind |
| Dung lượng .md | ~1.360 ký tự/ghi chú | **~660 ký tự/ghi chú** |
| Computed style | Dump cả 24 thuộc tính cho mọi note (48% dung lượng) | Chỉ nhóm liên quan tới từ khoá trong nội dung ghi chú |
| Thuộc tính element | `outerHTML` cắt cụt 240 ký tự | `class` đủ 400 ký tự + `data-*`, `id`, `role`, `aria-label` |
| Chuỗi class | In hai lần (ở `Class` và trong khối `html`) | In một lần |
| Mục lục | Có, và anchor của trang `/` luôn hỏng | Bỏ — agent không dùng tới |
| Tên React component | Không bắt | **Có** — đọc từ fiber qua script chạy ở world `MAIN` |
| Sửa ghi chú đã lưu | Không — chỉ xoá rồi ghi lại | **Có** — nút `✎` trong panel, sửa được cả element |

v2.0.0 nằm nguyên ở `../ui-annotate-extension/` nếu cần quay lại.

---

## 1. Cài đặt (2 phút, không cần build)

1. Mở `chrome://extensions`
2. Bật **Developer mode** (góc trên bên phải)
3. Bấm **Load unpacked** → chọn thư mục `ui-annotate-extension-v2.2`
4. Ghim icon extension lên thanh công cụ cho tiện

> **Tắt bản v2.0 trước đã.** Hai extension chạy ở hai isolated world riêng nên biến chặn
> nạp trùng `__uiAnnotateLoaded` không thấy nhau — bật cả hai là màn hình có 2 nút tròn và
> 2 panel chồng lên nhau. Ghi chú cũng **không dùng chung**: mỗi extension có
> `chrome.storage` riêng, note lưu ở v2.0 sẽ không hiện trong v2.2.

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
| `Alt` + click | Chọn element, mở ô ghi chú |
| `↑` / `↓` | Ra thẻ bọc ngoài / vào lại đúng thẻ con vừa rời |
| `←` / `→` | Anh em cùng cấp (đã lọc bỏ `<script>` và thẻ vô hình) |
| `Enter`, `Tab` | Nhảy vào ô gõ nội dung |
| `Alt` + `↑↓←→` | Đổi element **cả khi** con trỏ đang trong ô gõ |
| `Cmd/Ctrl` + `Enter` | Lưu ghi chú đang gõ |
| `Esc` | Đi từng nấc: đóng ô ghi chú trước, panel sau |
| `Alt` + `Shift` + `A` | Mở / đóng panel danh sách |
| `Alt` + `Shift` + `H` | Tắt / bật toàn bộ overlay (nhớ qua reload, dùng chung mọi site) |

Không cần nhớ: ô ghi chú có dấu **`?`** ở góc dưới bên trái, rê chuột vào là hiện đúng
bảng này. Bảng tự lật lên trên hay xuống dưới tuỳ chỗ còn trống, không bao giờ bị cắt cụt.

### Chọn element bằng phím mũi tên

Alt + click thường trúng đúng chữ chứ không trúng khối cần nói tới. Thay vì click đi click
lại, click một phát rồi lái bằng phím:

```
Alt+click vào giá tiền  →  ↑ ↑  lên tới cả thẻ sản phẩm  →  → → →  lướt sang các
sản phẩm kế bên  →  ↓  chui lại vào trong thẻ  →  Enter  →  gõ ghi chú
```

Tooltip hiện `<li> 187×556 · ↑ còn 5 · ←→ 3/20`:

- `↑ còn 5` — còn lên được 5 bậc nữa. **Con số này quan trọng**: phần lớn thẻ bọc chiếm
  đúng chỗ của thẻ con nên bấm `↑` xong khung xanh trông y hệt (đo trên tailwindcss.com là
  3/7 bậc như vậy). Không có số nhảy theo thì tưởng phím liệt rồi bấm quá tay.
- `←→ 3/20` — đang là cái thứ 3 trong 20 anh em. Tới `1/20` hay `20/20` thì `←`/`→` dừng
  hẳn, không vòng lại.

`←→` chỉ đếm anh em **nhìn thấy được**. Không lọc thì tính năng vô dụng: trên
tailwindcss.com có bậc 178 anh em mà 175 là thẻ `<script>` — phải bấm `→` 176 lần mới gặp
thứ nhìn thấy. Lọc bằng `checkVisibility()` chứ không bằng kích thước khung, vì container
grid có lúc trả về `width: 0` nhưng vẫn là thẻ bọc thật của cả trang.

### Sửa ghi chú đã lưu

Mỗi dòng trong panel có nút `✎` bên cạnh nút `×`. Bấm vào là mở lại đúng ô ghi chú đó, đã
điền sẵn nội dung và loại cũ.

Có hai mức sửa, extension tự chọn mức theo việc element còn hay mất:

| Tình huống | Sửa được gì |
|---|---|
| Element còn trên trang đang mở | Nội dung, loại, **và cả element** — lái `↑↓←→` sang khối khác rồi Lưu là đo lại toàn bộ (selector, class, CSS đang render, React component, kích thước) |
| Element đã mất, hoặc note của trang khác | Chỉ nội dung và loại. Ô ghi chú hiện dải vàng nói rõ phần đo đạc giữ nguyên |

Ba điểm về hành vi:

- **`id` và thời điểm ghi được giữ nguyên.** Thứ tự trong file `.md` vẫn là thứ tự QC phát
  hiện vấn đề, không phải thứ tự sửa lần cuối — sửa lại một note cũ không đẩy nó xuống cuối
  file. Lần sửa được đóng dấu riêng ở `editedAt`.
- **Xoá trắng ô rồi Lưu không phải là xoá note.** Nó bị hiểu là huỷ. Muốn xoá thì có nút `×`
  ngay cạnh.
- **Sửa note của trang khác không cần điều hướng.** Bấm `✎` từ tab **Toàn site** là sửa được
  chữ tại chỗ; bắt đi qua URL đó rồi mới cho sửa là quãng đường thừa khi chỉ cần gõ lại một câu.

### Vòng làm việc QC

1. Mở site cần QC, đi qua từng màn hình trong userflow.
2. Thấy chỗ sai → `Alt` + click → lái bằng `↑↓←→` cho trúng khối → `Enter` → gõ nội dung →
   chọn loại (**UI / Nội dung / Userflow / Bug**) → `Cmd+Enter`.
3. Chuyển trang thoải mái. Số trên nút tròn góc phải là **tổng ghi chú của cả site**.
   Ghi nhầm hay nghĩ lại thì mở panel bấm `✎` sửa, không cần xoá đi ghi lại.
4. Xong: mở panel → tab **Toàn site** → **Copy .md** hoặc **Tải .md**.
   (Hoặc bấm icon extension trên thanh công cụ → **Copy .md toàn site**.)
5. Quăng cho Claude Code sửa thẳng.

Panel có 2 tab:
- **Trang này** — chỉ ghi chú của URL đang mở; hover vào item để highlight lại element,
  click để cuộn tới nó.
- **Toàn site** — mọi ghi chú, gom theo từng đường dẫn; click item ở trang khác sẽ điều
  hướng sang đúng URL đó.

---

## 3. File Markdown xuất ra

```markdown
# QC UI — https://app.example.com · 12 ghi chú · 4 trang

> Mỗi mục là một chỗ cần sửa. `sel` là CSS selector lúc ghi chú; `class`/`attr` dùng để
> grep ra component trong source. `render` là giá trị **đang chạy sai**, không phải giá
> trị cần đạt.

## /checkout
https://app.example.com/checkout

### 1 · UI · `<button>` · Nút này phải cao 48px theo design, hiện đang 40px
- react: `<CheckoutButton>` trong `CheckoutForm` › `CheckoutPage`
- file: `src/components/CheckoutButton.tsx:42`
- sel: `#__next > main > form > div:nth-of-type(2) > button`
- class: `inline-flex items-center justify-center rounded-lg text-sm font-semibold bg-primary text-white h-10 px-4`
- attr: `type="submit"` `data-testid="checkout-submit"` `aria-label="Thanh toán"`
- text: "Thanh toán"
- box: 320×40 · màn hình 1512×982 (xl) · dpr 2
- render: `height: 40px` · `line-height: 20px` · `padding: 10px 16px`
```

Bốn điểm đáng chú ý:

**`react` là đường ngắn nhất tới file cần sửa** — ngắn hơn cả `class`/`attr`, vì trong phần
lớn codebase tên component chính là tên file. Đọc từ `__reactFiber$` mà React gắn lên DOM
node lúc chạy, nên đúng cả khi class là chuỗi hash (CSS Modules, styled-components) —
trường hợp mà grep theo class vô dụng hoàn toàn. Xem mục 3.1 cho giới hạn.

**`class` + `attr` là chìa khoá nối ghi chú với source.** Đây là thứ duy nhất trong file
cho phép agent tìm ra file component:

```bash
grep -rn "checkout-submit" src/
```

Vì vậy `class` được giữ tới 400 ký tự (v2.0 cắt ở 200 — với markup Tailwind là cắt mất
chìa khoá) và `data-*`, `id`, `role`, `aria-label` được bắt riêng thay vì chôn trong một
chuỗi `outerHTML` cắt cụt.

**`render` chỉ in nhóm CSS liên quan tới nội dung ghi chú.** Ghi chú nói "cao 48px" thì in
`height`/`padding`/`line-height`; nói "màu nền sai" thì in `color`/`background-color`. Ghi
chú loại **Nội dung** và **Userflow** không in `render` gì cả — CSS không giúp sửa lỗi
chính tả. Bảng từ khoá nằm ở `STYLE_HINTS` trong `shared.js`, sửa thoải mái: dò trượt thì
rơi về bộ mặc định chứ không mất gì.

**`box` luôn kèm kích thước màn hình và breakpoint Tailwind đang chạy.** Với codebase
Tailwind thì đây không phải thông tin phụ: cùng một element có
`text-4xl sm:text-5xl lg:text-6xl xl:text-8xl`, không biết QC đang ở bề rộng nào là không
biết phải sửa biến thể nào. Mỗi ghi chú giữ viewport riêng vì QC hay kéo co cửa sổ giữa
chừng. Bề cao màn hình cũng in vì các class dùng `vh`/`dvh` (`min-h-dvh`, `h-screen`) phụ
thuộc nó. Breakpoint suy theo mốc **mặc định** của Tailwind (sm 640 · md 768 · lg 1024 ·
xl 1280 · 2xl 1536) — project đổi mốc riêng thì con số px in ngay bên cạnh vẫn đúng để suy
lại. Bảng mốc nằm ở `BREAKPOINTS` trong `shared.js`.

**Không in `outerHTML` nữa.** `<tag>` + `class` + `attr` dựng lại được y hệt, mà in cả hai
thì riêng chuỗi class đã lặp hai lần trong cùng một mục.

---

### 3.1 Tên React component — chạy được tới đâu

Content script của extension nằm ở *isolated world*, không đọc được expando
`__reactFiber$…` của trang. Nên có thêm `react-probe.js` khai báo `"world": "MAIN"` trong
manifest: nó chạy cùng thế giới JS với trang, đọc fiber, trả kết quả về qua
`window.postMessage`. Vì là bất đồng bộ nên probe được bắn lúc **chọn** element (Alt+click
và mỗi lần bấm `↑↓←→`), kết quả nằm sẵn trong cache tới lúc bấm Lưu.

Đi ngược cây fiber lấy tối đa 3 tên: cái đầu là component cần sửa, hai cái sau là ngữ cảnh
(`Button` có ở khắp nơi; `Button` trong `CheckoutForm` thì chỉ một chỗ). Trên đường đi có
lọc bỏ `Fragment`, `Suspense`, `*Provider`, `Primitive.*` của radix, các wrapper router của
Next — chúng có mặt ở mọi element nên không định vị được gì.

**Giới hạn thật, đã đo:**

| Loại build | Kết quả |
|---|---|
| Dev (Vite / Next dev / localhost) | Tên đầy đủ; `file:dòng` khi bundler có gắn `_debugSource` |
| Production đã minify | **Không có tên** — tooltip ghi rõ `React (build đã minify tên)` |
| Không phải React | Không có dòng `react`, không tốn gì |

Đo trên `react.dev` (Next.js production): chuỗi tổ tiên ra `a` `d` `K` `tR` `p` `z` — tên đã
bị minify hết. In `<K>` vào file .md thì tệ hơn là không in, nên bộ lọc chặn mọi tên ≤ 2 ký
tự. Vài component vẫn lọt qua nếu bundler giữ tên (`Intro`, `MaxWidth` trên chính react.dev).

Kết luận thực dụng: **QC trên môi trường dev / staging chưa minify thì tính năng này ăn
tiền; QC thẳng trên production thì coi như không có nó**, `class`/`attr` vẫn là đường chính.

Trường `file` cần bundler gắn `_debugSource` (JSX transform ở chế độ development). React 19
đã bỏ trường này — mất `file` nhưng `react` vẫn còn. Không có thì dòng `file` không in ra.

Probe **chỉ đọc**: không patch gì của trang, không giữ tham chiếu, không gửi ra ngoài. Trang
nào không trả lời trong 300ms (bị CSP chặn, hoặc vừa reload extension mà chưa F5 tab) thì
sau 3 lần sẽ ngưng hỏi hẳn, không lặp vô ích.

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
- **iframe**: `↑↓←→` không đi xuyên qua được, và overlay chỉ chạy ở frame chính. Cần ghi
  chú bên trong iframe (payment widget, embed) thì đổi `"all_frames": false` → `true`
  trong `manifest.json`.
- **Mũi tên `↑` không bỏ qua thẻ bọc.** Cố ý: bỏ nhầm thì không có cách nào chọn lại thẻ
  đó nữa. Bù bằng bộ đếm `↑ còn N` trong tooltip. Nếu xài thấy mỏi tay thì thêm điều kiện
  bỏ bậc có khung trùng khít với thẻ con — sửa trong `navUp()`.
- **`←→` thỉnh thoảng dính element trợ năng** (`<next-route-announcer>` của Next.js, span
  `sr-only`): `checkVisibility()` coi chúng là hiện. Mất thêm một lần bấm, không lọc vì
  lọc theo kích thước sẽ giết nhầm container thật.
- **Selector sau khi SPA render lại**: `nth-of-type` có thể lệch nếu DOM đổi cấu trúc.
  File .md luôn kèm `text`, `class` và `attr` để tìm bù.
- **Tên React component trên build production**: không lấy được, vì tên đã bị minify —
  xem mục 3.1. Không phải lỗi, là giới hạn của thứ đang soi.
- **Framework khác**: Vue / Svelte / Angular chưa bắt tên component. Cùng cách làm (đọc
  `__vue_app__`, `__svelte_meta`) nhưng phải viết thêm bộ dò riêng trong `react-probe.js`.
- **Ảnh chụp element**: chưa có (đó là hướng của v2.1.0, không dùng ở nhánh này).

---

## 6. Cấu trúc file

```
ui-annotate-extension-v2.2/
├── manifest.json    khai báo extension (MV3)
├── content.js       overlay: soi element, điều hướng bằng phím, ô ghi chú, panel
├── react-probe.js   chạy ở world MAIN: đọc React fiber → tên component, trả về qua postMessage
├── shared.js        kho dữ liệu + bộ sinh Markdown (dùng chung content & popup)
├── background.js    service worker: hiện số ghi chú lên badge icon
├── popup.html/js    bảng điều khiển khi bấm icon
└── icons/           icon 16/32/48/128
```

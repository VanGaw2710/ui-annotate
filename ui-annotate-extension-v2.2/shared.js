/**
 * shared.js — kho dữ liệu + bộ sinh Markdown.
 *
 * Nạp ở cả content script lẫn popup nên không dùng ES module: mọi thứ treo vào
 * window.AN. Không đụng DOM ở đây để popup gọi được mà không cần trang web.
 */
(() => {
  "use strict";

  /** Note gom theo origin — đây là điểm khác cốt lõi so với bản localStorage
   *  theo từng pathname: đổi trang, F5, mở tab mới đều thấy chung một kho. */
  const notesKey = (origin) => "notes::" + origin;
  const ENABLED_KEY = "settings::enabled";

  /** Loại ghi chú — dùng để Dev lọc nhanh khi nhận file. */
  const KINDS = [
    { id: "ui", label: "UI" },
    { id: "copy", label: "Nội dung" },
    { id: "flow", label: "Userflow" },
    { id: "bug", label: "Bug" },
  ];

  const kindLabel = (id) => (KINDS.find((k) => k.id === id) || KINDS[0]).label;

  async function getNotes(origin) {
    const key = notesKey(origin);
    const bag = await chrome.storage.local.get(key);
    const list = bag[key];
    return Array.isArray(list) ? list : [];
  }

  async function setNotes(origin, notes) {
    await chrome.storage.local.set({ [notesKey(origin)]: notes });
  }

  async function clearNotes(origin) {
    await chrome.storage.local.remove(notesKey(origin));
  }

  /** Công tắc tổng, dùng chung mọi site. Chưa set = bật. */
  async function getEnabled() {
    const bag = await chrome.storage.local.get(ENABLED_KEY);
    return bag[ENABLED_KEY] !== false;
  }

  async function setEnabled(on) {
    await chrome.storage.local.set({ [ENABLED_KEY]: !!on });
  }

  /** Mọi origin đang có note — popup dùng để liệt kê. */
  async function listOrigins() {
    const all = await chrome.storage.local.get(null);
    return Object.entries(all)
      .filter(([k, v]) => k.startsWith("notes::") && Array.isArray(v) && v.length)
      .map(([k, v]) => ({ origin: k.slice(7), count: v.length }))
      .sort((a, b) => b.count - a.count);
  }

  /** Gom note theo path, giữ nguyên thứ tự path xuất hiện lần đầu. */
  function groupByPath(notes) {
    const map = new Map();
    for (const n of notes) {
      const path = n.path || "/";
      if (!map.has(path)) map.set(path, []);
      map.get(path).push(n);
    }
    return map;
  }

  // ───────────────────────────────────────────────────────────── markdown
  //
  // File này KHÔNG viết cho người đọc — nó viết cho Claude Code đọc rồi sửa
  // source. Vì vậy bỏ hết phần trang trí cho mắt người (mục lục, hướng dẫn
  // cách đọc, viewport / DPR) và dồn chỗ cho hai thứ agent thực sự dùng được:
  //
  //   1. `class` + `attr` — chìa khoá grep thẳng ra file component trong source.
  //      Đây là thứ duy nhất trong file nối được ghi chú với code.
  //   2. `render` — giá trị CSS đang chạy thật, nhưng CHỈ nhóm liên quan tới
  //      điều người QC than phiền. Dump cả 24 thuộc tính cho mọi note là cách
  //      nhanh nhất để nhấn chìm nội dung thật (đo được: chiếm 48% dung lượng).
  //
  // Không in `html` nữa: `<tag>` + `class` + `attr` dựng lại được y hệt, mà in
  // cả hai thì riêng chuỗi class đã lặp hai lần trong cùng một mục.

  /** Bỏ dấu để dò từ khoá không phụ thuộc người gõ có dấu hay không. */
  function noAccent(s) {
    return s
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .toLowerCase();
  }

  /**
   * Ghi chú nói về cái gì thì in giá trị đang render của đúng nhóm đó.
   * Từ khoá cả tiếng Việt lẫn tiếng Anh vì QC hay gõ lẫn lộn. Thêm/bớt thoải
   * mái — sai thì rơi về STYLE_FALLBACK chứ không mất gì.
   */
  const STYLE_HINTS = [
    [/\b(cao|thap|lun|height)\b/, ["height", "min-height", "line-height", "padding"]],
    [/\b(rong|hep|ngang|width|tran)\b/, ["width", "max-width", "padding", "overflow"]],
    [/\b(mau|nen|color|background|bg)\b/, ["color", "background-color", "opacity"]],
    [/\b(chu|font|size|dam|hoa thuong|in hoa)\b/, ["font-size", "font-weight", "font-family", "line-height", "letter-spacing", "text-transform"]],
    [/\b(bo goc|bo tron|radius)\b/, ["border-radius"]],
    [/\b(vien|border|duong ke)\b/, ["border", "border-radius"]],
    [/\b(bong|shadow)\b/, ["box-shadow"]],
    [/\b(khoang cach|thua|sat|spacing|gap|margin|padding)\b/, ["margin", "padding", "gap"]],
    [/\b(can giua|can le|canh le|lech|align|center|justify)\b/, ["text-align", "justify-content", "align-items", "flex-direction"]],
    [/\b(de len|chong len|z-index|zindex)\b/, ["z-index", "position"]],
    [/\b(mo|opacity|an di|hien ra|hide|show)\b/, ["opacity", "display"]],
    [/\b(xuong dong|cat chu|overflow|wrap)\b/, ["overflow", "white-space"]],
  ];

  /** Không dò ra từ khoá nào thì in bộ tối thiểu — đủ để đối chiếu, không phình. */
  const STYLE_FALLBACK = ["width", "height", "font-size", "color", "background-color", "padding", "gap"];

  function relevantStyles(n) {
    const styles = n.styles;
    if (!styles) return [];
    // Note về câu chữ / luồng đi thì CSS không giúp gì cho việc sửa.
    if (n.kind === "copy" || n.kind === "flow") return [];

    const hay = noAccent(n.note || "");
    const want = new Set();
    for (const [re, props] of STYLE_HINTS) {
      if (re.test(hay)) props.forEach((p) => want.add(p));
    }
    const picked = want.size ? [...want] : STYLE_FALLBACK;
    return picked
      .filter((p) => styles[p])
      .slice(0, 8) // trần cứng: một note trúng 3 nhóm từ khoá vẫn không được phình lại như cũ
      .map((p) => `\`${p}: ${styles[p]}\``);
  }

  /**
   * Tên React component đọc từ fiber của trang. Đây là đường ngắn nhất từ ghi
   * chú tới file cần sửa — ngắn hơn cả `class`/`attr`, vì nó là chính cái tên
   * file trong phần lớn codebase. Dev build còn kèm `_debugSource` nên in được
   * thẳng `file:dòng`, khỏi grep.
   *
   *   - react: `<PriceTag>` trong `ProductCard` › `ProductGrid`
   *   - file: `src/components/PriceTag.tsx:31`
   */
  function reactLine(n) {
    const r = n.react;
    if (!r || !r.chain || !r.chain.length) return "";
    const [self, ...parents] = r.chain;
    let line = `\`<${self}>\``;
    if (parents.length) line += " trong " + parents.map((p) => `\`${p}\``).join(" › ");
    return line;
  }

  /** data-*, id, role, aria-label… — thứ grep được ra component. */
  function attrLine(n) {
    if (!n.attrs) return "";
    const parts = Object.entries(n.attrs).map(([k, v]) =>
      v === "" ? `\`${k}\`` : `\`${k}="${v}"\``
    );
    return parts.join(" ");
  }

  /**
   * Element bọc (có con): textContent là chữ của cả đám con gộp lại, dán nguyên
   * vào chỉ tổ nhiễu. Element lá thì chính chữ đó là chìa khoá grep tốt nhất.
   */
  function textLine(n) {
    if (!n.text) return "";
    if (n.kids > 0) return n.text.length > 40 ? n.text.slice(0, 40) + "…" : n.text;
    return n.text;
  }

  /**
   * Breakpoint Tailwind mặc định đang có hiệu lực. Đây là thứ nối thẳng ra tiền
   * tố class cần sửa (`lg:`, `xl:`…). Project đổi breakpoint riêng thì con số px
   * in ngay bên cạnh vẫn là sự thật để suy lại.
   */
  const BREAKPOINTS = [[1536, "2xl"], [1280, "xl"], [1024, "lg"], [768, "md"], [640, "sm"]];

  function breakpoint(w) {
    for (const [min, name] of BREAKPOINTS) if (w >= min) return name;
    return "base";
  }

  /**
   * Kích thước màn hình lúc ghi chú — LUÔN in, không phải thông tin phụ. Cùng
   * một element có `text-4xl sm:text-5xl lg:text-6xl xl:text-8xl` thì không biết
   * QC đang ở bề rộng nào là không biết phải sửa biến thể nào. Mỗi note giữ
   * viewport riêng của nó vì QC hay kéo co cửa sổ giữa chừng.
   */
  function sizeLine(n) {
    const parts = [`${n.box.w}×${n.box.h}`];
    if (n.viewport) {
      const wh = n.viewportH ? `${n.viewport}×${n.viewportH}` : `${n.viewport}`;
      parts.push(`màn hình ${wh} (${breakpoint(n.viewport)})`);
    }
    if (n.dpr && n.dpr !== 1) parts.push(`dpr ${n.dpr}`);
    return parts.join(" · ");
  }

  /**
   * Một file Markdown cho toàn bộ origin, chia mục theo từng đường dẫn.
   * @param {string} origin
   * @param {Array<Object>} notes
   */
  function toMarkdown(origin, notes) {
    if (!notes.length) return "";

    const grouped = groupByPath(notes);
    const out = [];

    out.push(`# QC UI — ${origin} · ${notes.length} ghi chú · ${grouped.size} trang`);
    out.push("");
    // Một dòng khung duy nhất. Cần thiết vì không có nó agent rất dễ hiểu nhầm
    // `render` là giá trị MONG MUỐN thay vì giá trị đang sai.
    out.push(
      "> Mỗi mục là một chỗ cần sửa. `sel` là CSS selector lúc ghi chú; `class`/`attr` dùng để " +
        "grep ra component trong source. `render` là giá trị **đang chạy sai**, không phải giá trị cần đạt. " +
        "`box` kèm bề rộng màn hình lúc ghi chú và breakpoint Tailwind đang chạy — sửa đúng biến thể đó. " +
        "`react` là tên component đọc từ React fiber lúc chạy; `file` chỉ có ở dev build, đã là đường dẫn thật trong source."
    );

    let i = 0;
    for (const [path, items] of grouped) {
      out.push("");
      out.push(`## ${path}`);
      out.push(items[0].url);

      for (const n of items) {
        i++;
        out.push("");
        out.push(`### ${i} · ${kindLabel(n.kind)} · \`<${n.tag}>\` · ${n.note}`);
        // Đặt trên `sel`: có tên component thì agent không cần đọc tiếp dòng nào nữa.
        const react = reactLine(n);
        if (react) out.push(`- react: ${react}`);
        if (n.react && n.react.file) out.push(`- file: \`${n.react.file}\``);

        out.push(`- sel: \`${n.selector}\``);
        if (n.classes) out.push(`- class: \`${n.classes}\``);

        const attrs = attrLine(n);
        if (attrs) out.push(`- attr: ${attrs}`);
        // Note tạo bởi bản cũ chưa có `attrs` — vẫn in được thay vì mất trắng.
        else if (n.html) out.push(`- html: \`${n.html}\``);

        // Thẻ bọc trần: chính nó không grep được, đưa tổ tiên gần nhất ra thay.
        if (n.anchor) out.push(`- trong: \`${n.anchor}\``);

        const text = textLine(n);
        if (text) out.push(`- text: "${text}"`);
        out.push(`- box: ${sizeLine(n)}`);

        const styles = relevantStyles(n);
        if (styles.length) out.push(`- render: ${styles.join(" · ")}`);
      }
    }

    return out.join("\n");
  }

  /** Tên file gợi ý khi tải về. */
  function fileName(origin) {
    const host = origin.replace(/^https?:\/\//, "").replace(/[^a-z0-9.-]/gi, "-");
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
    return `ui-qc-${host}-${stamp}.md`;
  }

  window.AN = {
    KINDS,
    kindLabel,
    getNotes,
    setNotes,
    clearNotes,
    getEnabled,
    setEnabled,
    listOrigins,
    groupByPath,
    toMarkdown,
    fileName,
    notesKey,
    ENABLED_KEY,
  };
})();

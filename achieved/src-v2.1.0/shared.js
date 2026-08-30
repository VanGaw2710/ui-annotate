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
  const SHOTS_KEY = "settings::shots";

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

  /** Có chụp ảnh element kèm ghi chú không. Chưa set = có. */
  async function getShots() {
    const bag = await chrome.storage.local.get(SHOTS_KEY);
    return bag[SHOTS_KEY] !== false;
  }

  async function setShots(on) {
    await chrome.storage.local.set({ [SHOTS_KEY]: !!on });
  }

  /** Mọi origin đang có note — popup dùng để liệt kê. */
  async function listOrigins() {
    const all = await chrome.storage.local.get(null);
    return Object.entries(all)
      .filter(([k, v]) => k.startsWith("notes::") && Array.isArray(v) && v.length)
      .map(([k, v]) => ({ origin: k.slice(7), count: v.length }))
      .sort((a, b) => b.count - a.count);
  }

  // ───────────────────────────────────────────────────────────── markdown

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

  /**
   * Anchor kiểu GitHub cho mục lục. GitHub thay TỪNG khoảng trắng bằng một dấu
   * gạch (không gộp), nên "a — b" ra "a--b"; gộp \s+ sẽ lệch anchor.
   */
  function slugify(text) {
    return text
      .toLowerCase()
      .replace(/[`"'.]/g, "")
      .replace(/[^a-z0-9À-ỹ\s-]/g, "")
      .trim()
      .replace(/\s/g, "-");
  }

  /** Nhóm computed style thành các dòng ngắn, bỏ giá trị vô nghĩa. */
  function styleLines(styles) {
    if (!styles) return [];
    const groups = [
      ["Chữ", ["font-family", "font-size", "font-weight", "line-height", "letter-spacing", "text-align", "text-transform"]],
      ["Màu", ["color", "background-color", "border", "border-radius", "box-shadow", "opacity"]],
      ["Hộp", ["display", "width", "height", "padding", "margin", "gap"]],
      ["Bố cục", ["position", "flex-direction", "justify-content", "align-items", "overflow", "z-index"]],
    ];
    const out = [];
    for (const [title, props] of groups) {
      const parts = props
        .filter((p) => styles[p])
        .map((p) => `\`${p}: ${styles[p]}\``);
      if (parts.length) out.push(`  - ${title}: ${parts.join(" · ")}`);
    }
    return out;
  }

  /** Tên file ảnh trong gói .zip — đánh số theo đúng thứ tự mục trong .md. */
  function shotPath(note, index) {
    return `anh/${String(index).padStart(2, "0")}-${note.tag}.webp`;
  }

  /**
   * Một file Markdown cho toàn bộ origin, chia mục theo từng đường dẫn.
   * @param {string} origin
   * @param {Array<Object>} notes
   * @param {{withImages?: boolean}} [opts]  true = trỏ tới file ảnh trong .zip
   */
  function toMarkdown(origin, notes, opts = {}) {
    if (!notes.length) return "";

    const grouped = groupByPath(notes);
    const now = new Date().toLocaleString("vi-VN");
    const shots = notes.filter((n) => n.shot).length;
    const out = [];

    out.push(`# UI QC — ${origin}`);
    out.push("");
    out.push(
      `${notes.length} ghi chú · ${grouped.size} trang · xuất lúc ${now}` +
        (shots ? ` · ${shots} ảnh chụp` : "")
    );
    out.push("");
    out.push(
      "> **Cách đọc:** mỗi mục là một điều chỉnh cần thực hiện. `Selector` dùng để định vị " +
        "element — dán `document.querySelector(\"…\")` vào console là thấy. Nếu selector không " +
        "còn khớp (SPA render lại DOM), tìm theo `Text` hoặc `Class`. `Computed style` là giá " +
        "trị **đang chạy thật** trên trình duyệt lúc ghi chú, dùng để so với design."
    );
    out.push("");

    // Mục lục — file nhiều trang thì đây là thứ Dev cần trước tiên.
    out.push("## Mục lục");
    out.push("");
    let idx = 0;
    for (const [path, items] of grouped) {
      idx++;
      out.push(`${idx}. [\`${path}\`](#${slugify(path + " — " + items.length + " ghi chú")}) — ${items.length} ghi chú`);
    }
    out.push("");
    out.push("---");
    out.push("");

    let i = 0;
    for (const [path, items] of grouped) {
      out.push(`## \`${path}\` — ${items.length} ghi chú`);
      out.push("");
      out.push(`URL: ${items[0].url}`);
      out.push("");

      for (const n of items) {
        i++;
        const el = `<${n.tag}${n.classes ? "." + n.classes.trim().split(/\s+/).slice(0, 2).join(".") : ""}>`;
        out.push(`### ${i}. [${kindLabel(n.kind)}] ${el} — ${n.note}`);
        out.push("");
        out.push(`- **Selector:** \`${n.selector}\``);
        if (n.classes) out.push(`- **Class:** \`${n.classes}\``);
        if (n.text) out.push(`- **Text:** "${n.text}"`);
        out.push(`- **Kích thước:** ${n.box.w}×${n.box.h}px · viewport ${n.viewport}px${n.dpr && n.dpr !== 1 ? ` · DPR ${n.dpr}` : ""}`);
        const styles = styleLines(n.styles);
        if (styles.length) {
          out.push("- **Computed style:**");
          out.push(...styles);
        }
        if (n.shot) {
          out.push(
            opts.withImages
              ? `- **Ảnh chụp:**${n.shot.partial ? " (element vượt khung nhìn, ảnh chỉ có phần đang thấy)" : ""}`
              : "- **Ảnh chụp:** có — tải bản `.zip` để xem"
          );
          if (opts.withImages) {
            out.push("");
            out.push(`  ![${n.note.replace(/[\[\]]/g, "")}](${shotPath(n, i)})`);
          }
        }
        out.push("");
        out.push("```html");
        out.push(n.html);
        out.push("```");
        out.push("");
      }
    }

    return out.join("\n");
  }

  /** Thứ tự note đúng như khi in ra .md (gom theo trang) — để đánh số ảnh khớp. */
  function orderedNotes(notes) {
    return [...groupByPath(notes).values()].flat();
  }

  /**
   * Gói .zip giao Dev: report.md + thư mục anh/ chứa ảnh chụp từng element.
   * Không nhúng base64 vào .md vì file sẽ phình vài MB và nhiều trình đọc
   * markdown chặn ảnh dạng data: URI.
   * @returns {{blob: Blob, name: string}}
   */
  function buildZip(origin, notes) {
    const files = [
      { name: "report.md", data: toMarkdown(origin, notes, { withImages: true }) },
    ];
    orderedNotes(notes).forEach((n, idx) => {
      if (!n.shot) return;
      files.push({
        name: shotPath(n, idx + 1),
        data: window.ANZip.fromDataUrl(n.shot.data),
      });
    });
    return {
      blob: window.ANZip.zip(files),
      name: fileName(origin).replace(/\.md$/, ".zip"),
    };
  }

  /** Số note có ảnh — dùng để quyết định hiện nút tải .zip. */
  const shotCount = (notes) => notes.filter((n) => n.shot).length;

  /** Dung lượng ghi chú của một origin đang chiếm, dạng chữ dễ đọc. */
  async function usageText(origin) {
    try {
      const bytes = await chrome.storage.local.getBytesInUse(notesKey(origin));
      if (bytes < 1024) return bytes + " B";
      if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + " KB";
      return (bytes / 1024 / 1024).toFixed(1) + " MB";
    } catch {
      return null;
    }
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
    getShots,
    setShots,
    listOrigins,
    groupByPath,
    orderedNotes,
    toMarkdown,
    buildZip,
    shotCount,
    usageText,
    shotPath,
    fileName,
    notesKey,
    ENABLED_KEY,
    SHOTS_KEY,
  };
})();

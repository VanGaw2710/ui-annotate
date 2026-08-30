/**
 * content.js — overlay ghi chú UI, chạy trên mọi website.
 *
 * Khác bản annotate.js cũ ở ba điểm:
 *  1. Không cần nhúng vào source site — extension tự bơm vào mọi trang.
 *  2. Note lưu theo ORIGIN trong chrome.storage → chuyển trang / F5 / mở tab mới
 *     vẫn là một kho duy nhất, export ra một file .md cho cả website.
 *  3. Toàn bộ UI nằm trong Shadow DOM → CSS của site không phá được overlay.
 *
 * PHÍM TẮT
 *    Alt (giữ)       bật chế độ soi element
 *    Alt + click     chọn element, mở ô ghi chú
 *    ↑ / ↓           ra thẻ bọc ngoài / vào lại thẻ con vừa rời
 *    ← / →           anh em cùng cấp (đã lọc bỏ <script> và thẻ vô hình)
 *    Enter, Tab      nhảy vào ô gõ note
 *    Alt + ↑↓←→      đổi element cả khi con trỏ đang trong ô gõ
 *    Cmd/Ctrl+Enter  lưu note đang gõ
 *    Esc             thoát soi / đóng ô ghi chú / đóng panel
 *    Alt + Shift + A mở / đóng panel
 *    Alt + Shift + H tắt / bật overlay (nhớ qua reload, dùng chung mọi site)
 */
(() => {
  "use strict";

  if (window.__uiAnnotateLoaded) return;
  window.__uiAnnotateLoaded = true;

  // Trang không phải HTML (ảnh, PDF viewer…) thì không gắn gì cả.
  if (!document.body || document.contentType !== "text/html") return;

  const ORIGIN = location.origin;
  /** Đóng dấu bản đang chạy: reload extension mà quên F5 tab thì overlay cũ vẫn
   *  nằm nguyên trong DOM, nhìn code với nhìn màn hình ra hai kết quả khác nhau. */
  const VERSION = chrome.runtime.getManifest().version;

  /** @type {Array<Object>} */
  let notes = [];
  let enabled = true;
  let picking = false;
  let hovered = null;
  let panelOpen = false;
  let panelScope = "page"; // "page" | "site"
  /** id của note đang mở để sửa — null là đang tạo mới. */
  let editingId = null;
  let currentPath = location.pathname;

  // ────────────────────────────────────────────────── element → dữ liệu

  /** Selector ngắn nhất mà vẫn trỏ đúng một element. */
  function buildSelector(el) {
    // Vòng lặp dưới dừng ở body nên chọn đúng body sẽ ra chuỗi rỗng. Từ khi có
    // phím ↑ thì đi tới body là chuyện thường, phải chặn ở đây.
    if (el === document.body) return "body";
    if (el.id && document.querySelectorAll("#" + CSS.escape(el.id)).length === 1) {
      return "#" + CSS.escape(el.id);
    }
    const testId = el.getAttribute("data-testid");
    if (testId && document.querySelectorAll(`[data-testid="${testId}"]`).length === 1) {
      return `[data-testid="${testId}"]`;
    }

    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.body) {
      let part = node.tagName.toLowerCase();
      const parent = node.parentElement;
      if (parent) {
        const sameTag = [...parent.children].filter((c) => c.tagName === node.tagName);
        if (sameTag.length > 1) part += `:nth-of-type(${sameTag.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      if (document.querySelectorAll(parts.join(" > ")).length === 1) break;
      node = parent;
    }
    return parts.join(" > ");
  }

  /** Các thuộc tính hay lệch nhất khi QC UI so với design. */
  const STYLE_PROPS = [
    "display", "position", "width", "height", "padding", "margin", "gap",
    "font-family", "font-size", "font-weight", "line-height", "letter-spacing",
    "text-align", "text-transform", "color", "background-color",
    "border", "border-radius", "box-shadow", "opacity",
    "flex-direction", "justify-content", "align-items", "overflow", "z-index",
    "max-width", "min-height", "white-space",
  ];

  /** Giá trị mặc định / vô nghĩa — bỏ đi cho file .md gọn. */
  const NOISE = new Set([
    "none", "normal", "auto", "static", "0px", "visible", "rgba(0, 0, 0, 0)",
    "0px 0px 0px 0px", "1", "start", "stretch", "row",
  ]);

  function captureStyles(el) {
    const cs = getComputedStyle(el);
    const out = {};
    for (const prop of STYLE_PROPS) {
      let v = cs.getPropertyValue(prop).trim();
      if (!v || NOISE.has(v)) continue;
      // "0px none rgb(…)" = không có viền, nhưng vẫn trả về chuỗi dài → bỏ.
      if (prop === "border" && /^0px none/.test(v)) continue;
      if (prop === "margin" && /^0px( 0px)*$/.test(v)) continue;
      if (prop === "font-family") v = v.split(",")[0].replace(/["']/g, "").trim();
      if (v.length > 90) v = v.slice(0, 90) + "…";
      out[prop] = v;
    }
    return out;
  }

  /**
   * Thuộc tính bỏ qua: hoặc quá dài để grep (src base64, path của SVG), hoặc
   * không nói lên element này là component nào.
   */
  const ATTR_SKIP = /^(class|style|src|srcset|sizes|xmlns|viewbox|d|points|fill|stroke|on[a-z]+)$/i;

  /**
   * data-testid, data-slot, id, role, aria-label… — đây mới là thứ Claude Code
   * grep được để tìm ra file component, quý hơn mọi computed style. Trước đây
   * chỉ có outerHTML cắt cụt 240 ký tự, với markup Tailwind là cụt mất phần này.
   */
  function captureAttrs(el) {
    const out = {};
    let taken = 0;
    for (const a of el.attributes) {
      if (ATTR_SKIP.test(a.name) || a.value.length > 80) continue;
      out[a.name] = a.value;
      if (++taken >= 8) break;
    }
    return out;
  }

  // ────────────────────────────────────────────── tên React component
  //
  // Fiber (`__reactFiber$…`) là expando React gắn lên DOM node của TRANG. Content
  // script chạy ở isolated world nên không đọc được — phải nhờ react-probe.js
  // (world "MAIN") đọc hộ rồi trả về qua postMessage. Vì vậy việc này bất đồng
  // bộ, không nhét thẳng vào capture() được: probe được bắn lúc CHỌN element,
  // kết quả nằm sẵn trong cache tới lúc bấm Lưu.

  const REACT_MARK = "data-ui-annotate-probe";
  /** WeakMap để trang SPA thay DOM liên tục không giữ node chết lại. */
  const reactCache = new WeakMap();
  const reactWaiting = new Map();
  let reactSeq = 0;
  /** Trang không có React thì thôi hỏi lại — mỗi lần chọn element là một lần phí. */
  let reactAbsent = 0;

  window.addEventListener("message", (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.source !== "ui-annotate-probe" || d.type !== "react-result") return;
    const done = reactWaiting.get(d.id);
    if (done) {
      reactWaiting.delete(d.id);
      done(d.info);
    }
  });

  /**
   * Hỏi world MAIN xem element này thuộc component nào. Không await ở chỗ gọi:
   * kết quả tự rơi vào cache, ai cần thì đọc cache.
   */
  function probeReact(el) {
    if (!el || reactAbsent >= 3 || reactCache.has(el)) return;
    // Đặt chỗ ngay để không bắn trùng khi người dùng giữ phím mũi tên.
    reactCache.set(el, null);

    const id = ++reactSeq;
    el.setAttribute(REACT_MARK, "");
    const cleanup = () => el.removeAttribute(REACT_MARK);

    const timer = setTimeout(() => {
      // Không có react-probe.js trả lời (trang bị CSP chặn, hoặc extension vừa
      // reload mà tab chưa F5). Coi như không có React.
      if (reactWaiting.delete(id)) {
        reactAbsent++;
        cleanup();
        // Bỏ chỗ đã đặt: SPA chọn element trước lúc hydrate xong thì lần chọn
        // sau phải được hỏi lại, không kẹt vĩnh viễn ở kết quả rỗng.
        reactCache.delete(el);
      }
    }, 300);

    reactWaiting.set(id, (info) => {
      clearTimeout(timer);
      cleanup();
      if (info) {
        reactAbsent = 0;
        reactCache.set(el, info);
        // Tooltip đang chỉ vào đúng element này thì vẽ lại cho hiện tên.
        if (navEl === el) drawHighlight(el, navLabel(el));
      } else {
        reactAbsent++;
      }
    });

    window.postMessage({ source: "ui-annotate", type: "react-probe", id }, location.origin === "null" ? "*" : location.origin);
  }

  /**
   * Thẻ bọc trần — không class, không data-* — thì cả mục ghi chú không còn chữ
   * nào grep được, agent chỉ còn mỗi selector nth-of-type mong manh. Mà đi lên
   * bằng phím ↑ lại rất hay dừng đúng vào loại thẻ đó. Bám lấy tổ tiên gần nhất
   * còn grep được để vẫn có đường vào source.
   */
  function captureAnchor(el) {
    let node = el.parentElement;
    for (let i = 0; i < 4 && node && node !== document.body; i++) {
      const cls = (node.getAttribute("class") || "").trim();
      const key = [...node.attributes].find((a) => a.name === "id" || a.name.startsWith("data-"));
      if (cls || key) {
        return (
          `<${node.tagName.toLowerCase()}` +
          (cls ? ` class="${cls.slice(0, 160)}"` : "") +
          (key ? ` ${key.name}="${key.value.slice(0, 60)}"` : "") +
          ">"
        );
      }
      node = node.parentElement;
    }
    return "";
  }

  function capture(el, text, kind) {
    const rect = el.getBoundingClientRect();
    return {
      id: Date.now() + "-" + Math.random().toString(36).slice(2, 7),
      note: text,
      kind,
      tag: el.tagName.toLowerCase(),
      selector: buildSelector(el),
      // Nới từ 200: chuỗi class Tailwind dài hơn thế, mà cắt là mất chìa khoá grep.
      classes: (el.getAttribute("class") || "").trim().slice(0, 400),
      attrs: captureAttrs(el),
      anchor: "", // điền bên dưới, chỉ khi chính nó không grep được
      text: (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 160),
      // Số con — bộ sinh .md dùng để biết đây là element lá hay thẻ bọc, vì chữ
      // của thẻ bọc là chữ của cả đám con gộp lại, in nguyên vào chỉ tổ nhiễu.
      kids: el.children.length,
      styles: captureStyles(el),
      // Tên component + file trong source (nếu dev build). Rỗng khi trang không
      // dùng React hoặc probe chưa kịp trả lời — không phải lỗi, chỉ là thiếu.
      react: reactCache.get(el) || null,
      box: { w: Math.round(rect.width), h: Math.round(rect.height) },
      // Cả bề rộng lẫn bề cao: bề rộng quyết định breakpoint, bề cao quyết định
      // các class dùng vh/dvh (`min-h-dvh`, `h-screen`).
      viewport: window.innerWidth,
      viewportH: window.innerHeight,
      dpr: window.devicePixelRatio,
      url: location.href,
      path: location.pathname + location.search,
      title: document.title.slice(0, 120),
      at: new Date().toISOString(),
    };
  }

  /** Bọc capture: chỉ đi tìm tổ tiên khi chính element không để lại chìa khoá. */
  function captureNote(el, text, kind) {
    const n = capture(el, text, kind);
    if (!n.classes && !Object.keys(n.attrs).length) n.anchor = captureAnchor(el);
    return n;
  }

  // ──────────────────────────────────────────────────────────── storage

  async function persist() {
    await AN.setNotes(ORIGIN, notes);
  }

  function notesOfPage() {
    const path = location.pathname + location.search;
    return notes.filter((n) => n.path === path);
  }

  // ───────────────────────────────────────────── export .md / clipboard

  function currentMarkdown() {
    const list = panelScope === "page" ? notesOfPage() : notes;
    return AN.toMarkdown(ORIGIN, list);
  }

  async function copyMarkdown() {
    const md = currentMarkdown();
    if (!md) return flash("Chưa có ghi chú nào");
    try {
      await navigator.clipboard.writeText(md);
    } catch {
      // Site chặn clipboard API → fallback textarea trong shadow root.
      const ta = document.createElement("textarea");
      ta.value = md;
      root.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    flash(`Đã copy ${panelScope === "page" ? "trang này" : "toàn site"}`);
  }

  function downloadMarkdown() {
    const md = currentMarkdown();
    if (!md) return flash("Chưa có ghi chú nào");
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = AN.fileName(ORIGIN);
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    flash("Đang tải file .md");
  }

  // ───────────────────────────────────────────────────── shadow DOM UI

  const host = document.createElement("div");
  host.id = "ui-annotate-root";
  // Mọi khai báo phải !important: site có thể có `* { font-family: … !important }`
  // — rule !important của trang thắng cả inline style thường, kéo overlay đổ theo
  // font của site. Element con nằm trong shadow tree nên selector `*` của trang
  // không với tới, chỉ cần chặn ở host là đủ.
  host.style.cssText = [
    "all: initial !important",
    "position: fixed !important",
    "inset: 0 !important",
    "z-index: 2147483647 !important",
    "pointer-events: none !important",
    "font: 13px/1.45 ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif !important",
    "color: #0f172a !important",
  ].join("; ");
  const root = host.attachShadow({ mode: "open" });
  document.documentElement.appendChild(host);

  const style = document.createElement("style");
  style.textContent = `
    :host, * { box-sizing: border-box; }
    :host { font: 13px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
    button { font: inherit; }

    #highlight {
      position: fixed; pointer-events: none;
      border: 1.5px solid #2563eb; background: rgba(37,99,235,.10);
      border-radius: 3px; transition: all .06s linear;
    }
    #tip {
      position: fixed; pointer-events: none;
      background: #1e293b; color: #e2e8f0; padding: 3px 7px;
      border-radius: 4px; font-size: 11px; white-space: nowrap;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }

    #fab {
      position: fixed; right: 16px; bottom: 16px; pointer-events: auto;
      display: flex; align-items: center; gap: 8px;
      background: #0f172a; color: #f8fafc; border: 0;
      padding: 9px 14px; border-radius: 999px; cursor: pointer;
      box-shadow: 0 4px 16px rgba(15,23,42,.28);
    }
    #fab b { background: #2563eb; border-radius: 999px; padding: 1px 7px; font-size: 11px; }
    #fab.off { display: none; }

    #panel {
      position: fixed; right: 16px; bottom: 66px; pointer-events: auto;
      width: 360px; max-height: 66vh; display: flex; flex-direction: column;
      background: #fff; color: #0f172a; border: 1px solid #e2e8f0;
      border-radius: 10px; box-shadow: 0 12px 32px rgba(15,23,42,.18);
    }
    #panel header { padding: 12px 14px 8px; border-bottom: 1px solid #f1f5f9; }
    #panel .row { display: flex; gap: 6px; align-items: center; }
    #panel .row + .row { margin-top: 8px; }
    #panel strong { flex: 1; font-size: 13px; }
    .tabs { display: flex; gap: 4px; background: #f1f5f9; padding: 2px; border-radius: 7px; }
    .tabs button {
      border: 0; background: none; color: #475569; cursor: pointer;
      padding: 4px 10px; border-radius: 5px; font-size: 12px;
    }
    .tabs button.on { background: #fff; color: #0f172a; box-shadow: 0 1px 2px rgba(15,23,42,.12); }
    button.act {
      border: 1px solid #cbd5e1; background: #f8fafc; color: #0f172a;
      border-radius: 6px; padding: 4px 9px; cursor: pointer; font-size: 12px;
    }
    button.act:hover { background: #eef2f7; }
    button.act.danger:hover { background: #fef2f2; border-color: #fca5a5; color: #b91c1c; }

    #list { overflow: auto; flex: 1; }
    .group { padding: 8px 14px 2px; font-size: 11px; color: #64748b; background: #f8fafc;
      border-bottom: 1px solid #f1f5f9; font-family: ui-monospace, Menlo, monospace; }
    .item { padding: 10px 14px; border-bottom: 1px solid #f1f5f9; }
    .item p { margin: 0 0 4px; font-weight: 550; }
    .item code { font-size: 11px; color: #64748b; word-break: break-all;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    .item .del, .item .edit { float: right; border: 0; background: none; cursor: pointer;
      color: #94a3b8; font-size: 15px; line-height: 1; padding: 0 2px; }
    .item .edit { font-size: 12px; margin-right: 4px; }
    .item .del:hover { color: #dc2626; }
    .item .edit:hover { color: #2563eb; }
    .item.editing { background: #eff6ff; }
    .kind { display: inline-block; font-size: 10px; padding: 1px 6px; border-radius: 999px;
      background: #e0e7ff; color: #3730a3; margin-right: 6px; vertical-align: 1px; }
    .kind.copy { background: #dcfce7; color: #166534; }
    .kind.flow { background: #fef3c7; color: #92400e; }
    .kind.bug  { background: #fee2e2; color: #991b1b; }
    #empty { padding: 22px 14px; color: #64748b; text-align: center; }

    #input {
      position: fixed; pointer-events: auto; width: 320px;
      background: #fff; border: 1px solid #cbd5e1; border-radius: 10px;
      box-shadow: 0 12px 32px rgba(15,23,42,.22); padding: 12px;
    }
    /* Sửa note cũ mà element không còn trên trang: nói rõ cái gì sẽ đổi, cái gì
       giữ nguyên. Không có dòng này thì người dùng tưởng bấm Lưu là đo lại hết. */
    #input .warn { font-size: 11px; line-height: 1.45; color: #92400e; background: #fffbeb;
      border: 1px solid #fde68a; border-radius: 6px; padding: 6px 8px; margin-bottom: 8px; }
    #input code { display: block; font-size: 11px; color: #64748b; margin-bottom: 8px;
      word-break: break-all; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    #input textarea {
      width: 100%; height: 74px; resize: vertical; padding: 8px; color: #0f172a;
      background: #fff; border: 1px solid #cbd5e1; border-radius: 6px; font: inherit;
    }
    #input .kinds { display: flex; gap: 4px; margin-top: 8px; }

    #input .help { position: relative; margin-right: auto; display: flex; }
    #input .qmark {
      width: 19px; height: 19px; padding: 0; border-radius: 999px; line-height: 1;
      border: 1px solid #cbd5e1; background: #f8fafc; color: #64748b;
      font-size: 11px; font-weight: 700; cursor: help;
      display: flex; align-items: center; justify-content: center;
    }
    #input .help:hover .qmark { background: #0f172a; border-color: #0f172a; color: #fff; }
    /* position: fixed — chỗ đặt do JS tính, vì ô ghi chú có thể mở sát mép trên
       màn hình (rất hay xảy ra khi ghi chú header) và bảng sẽ bị cắt cụt. */
    #input .keys {
      display: none; position: fixed; width: 286px; z-index: 1;
      background: #0f172a; color: #e2e8f0; border-radius: 8px; padding: 9px 11px;
      box-shadow: 0 10px 28px rgba(15, 23, 42, .34);
    }
    #input .krow { display: flex; gap: 9px; align-items: baseline; padding: 2px 0; font-size: 11px; }
    #input .krow kbd {
      flex: 0 0 104px; text-align: right; color: #f8fafc; white-space: nowrap;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10.5px;
    }
    #input .krow span { color: #94a3b8; }
    #input .kinds button {
      border: 1px solid #e2e8f0; background: #f8fafc; color: #475569;
      border-radius: 999px; padding: 3px 10px; cursor: pointer; font-size: 11px;
    }
    #input .kinds button.on { background: #0f172a; border-color: #0f172a; color: #fff; }
    #input .actions { display: flex; gap: 6px; justify-content: flex-end;
      align-items: center; margin-top: 10px; }
    #input .actions button { border-radius: 6px; padding: 5px 12px; cursor: pointer;
      font-size: 12px; border: 1px solid #cbd5e1; background: #f8fafc; color: #0f172a; }
    #input .actions button.primary { background: #2563eb; border-color: #2563eb; color: #fff; }

    #flash {
      position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%);
      background: #0f172a; color: #f8fafc; padding: 8px 16px;
      border-radius: 999px; font-size: 12px; pointer-events: none;
    }
  `;
  root.appendChild(style);

  const highlight = mk("div", { id: "highlight" });
  const tip = mk("div", { id: "tip" });
  const fab = mk("button", { id: "fab" });
  const panel = mk("div", { id: "panel" });
  hide(highlight, tip, panel);
  root.append(highlight, tip, fab, panel);

  function mk(tag, props = {}) {
    return Object.assign(document.createElement(tag), props);
  }

  function hide(...nodes) {
    nodes.forEach((n) => (n.style.display = "none"));
  }

  function flash(msg) {
    root.querySelector("#flash")?.remove();
    const f = mk("div", { id: "flash", textContent: msg });
    root.appendChild(f);
    setTimeout(() => f.remove(), 1800);
  }

  function renderFab() {
    fab.textContent = "";
    fab.append(
      mk("span", { textContent: "Ghi chú UI" }),
      mk("b", { textContent: String(notes.length) })
    );
    fab.title = `UI Annotate v${VERSION} · ${notesOfPage().length} ghi chú ở trang này · ${notes.length} toàn site`;
  }

  function renderPanel() {
    if (!panelOpen) return;
    panel.textContent = "";

    const list = panelScope === "page" ? notesOfPage() : notes;

    const head = mk("header");
    const row1 = mk("div", { className: "row" });
    const tabs = mk("div", { className: "tabs" });
    const tPage = mk("button", { textContent: `Trang này (${notesOfPage().length})` });
    const tSite = mk("button", { textContent: `Toàn site (${notes.length})` });
    (panelScope === "page" ? tPage : tSite).classList.add("on");
    tPage.onclick = () => { panelScope = "page"; renderPanel(); };
    tSite.onclick = () => { panelScope = "site"; renderPanel(); };
    tabs.append(tPage, tSite);
    row1.append(tabs);

    const row2 = mk("div", { className: "row" });
    const copyBtn = mk("button", { className: "act", textContent: "Copy .md" });
    const dlBtn = mk("button", { className: "act", textContent: "Tải .md" });
    const clearBtn = mk("button", { className: "act danger", textContent: "Xoá hết" });
    copyBtn.onclick = copyMarkdown;
    dlBtn.onclick = downloadMarkdown;
    clearBtn.onclick = async () => {
      if (!notes.length) return;
      if (!confirm(`Xoá toàn bộ ${notes.length} ghi chú của ${ORIGIN}?`)) return;
      notes = [];
      await AN.clearNotes(ORIGIN);
      renderFab();
      renderPanel();
      flash("Đã xoá hết");
    };
    row2.append(mk("strong", { textContent: ORIGIN.replace(/^https?:\/\//, "") }), copyBtn, dlBtn, clearBtn);

    head.append(row1, row2);
    panel.appendChild(head);

    const box = mk("div", { id: "list" });
    panel.appendChild(box);

    if (!list.length) {
      box.appendChild(
        mk("div", { id: "empty", textContent: "Giữ Alt rồi click vào element bất kỳ để ghi chú." })
      );
      return;
    }

    const groups = panelScope === "site" ? AN.groupByPath(list) : new Map([[null, list]]);
    for (const [path, items] of groups) {
      if (path !== null) box.appendChild(mk("div", { className: "group", textContent: path }));
      for (const n of items) box.appendChild(renderItem(n));
    }
  }

  function renderItem(n) {
    const item = mk("div", { className: "item" });
    if (editingId === n.id) item.classList.add("editing");
    const del = mk("button", { className: "del", textContent: "×", title: "Xoá ghi chú" });
    const edit = mk("button", { className: "edit", textContent: "✎", title: "Sửa ghi chú" });
    edit.onclick = (e) => {
      e.stopPropagation(); // đừng để rơi xuống item.onclick — nó cuộn trang / đổi URL
      openEdit(n);
    };
    del.onclick = async () => {
      notes = notes.filter((x) => x.id !== n.id);
      await persist();
      renderFab();
      renderPanel();
    };
    const p = mk("p");
    p.append(
      mk("span", { className: "kind " + n.kind, textContent: AN.kindLabel(n.kind) }),
      document.createTextNode(n.note)
    );
    const c = mk("code", { textContent: n.selector });
    item.append(del, edit, p, c);

    // Chỉ soi được element khi note thuộc đúng trang đang mở.
    const samePage = n.path === location.pathname + location.search;
    if (samePage) {
      item.onmouseenter = () => {
        const target = safeQuery(n.selector);
        if (target) drawHighlight(target);
      };
      item.onmouseleave = () => hide(highlight, tip);
      item.onclick = (e) => {
        if (e.target === del || e.target === edit) return;
        safeQuery(n.selector)?.scrollIntoView({ block: "center", behavior: "smooth" });
      };
    } else {
      item.onclick = (e) => {
        if (e.target === del || e.target === edit) return;
        location.href = n.url;
      };
      item.title = "Mở " + n.url;
    }
    return item;
  }

  /**
   * Mở ô ghi chú với nội dung cũ. Note của trang khác vẫn sửa được chữ tại chỗ —
   * bắt điều hướng sang URL đó rồi mới cho sửa là quãng đường vô ích khi người
   * dùng chỉ muốn gõ lại một câu.
   */
  function openEdit(n) {
    const samePage = n.path === location.pathname + location.search;
    const target = samePage ? safeQuery(n.selector) : null;
    if (target) navReveal(target);
    // Đặt bên trái panel để không bị panel (rộng 360, cách phải 16) che mất.
    const x = Math.max(12, window.innerWidth - 360 - 16 - 332);
    openInput(target, x, Math.min(96, window.innerHeight - 300), n);
    // Vẽ lại panel SAU khi openInput đặt editingId — nếu không thì dòng đang sửa
    // không có nền, người dùng mở 2-3 ô liên tiếp là mất dấu đang sửa cái nào.
    renderPanel();
    root.querySelector("#input textarea")?.focus();
  }

  /** Selector cũ có thể không còn hợp lệ sau khi SPA render lại. */
  function safeQuery(selector) {
    try {
      return document.querySelector(selector);
    } catch {
      return null;
    }
  }

  function togglePanel(force) {
    panelOpen = force !== undefined ? force : !panelOpen;
    panel.style.display = panelOpen ? "flex" : "none";
    if (panelOpen) renderPanel();
  }

  fab.onclick = () => togglePanel();

  function drawHighlight(target, label) {
    const r = target.getBoundingClientRect();
    Object.assign(highlight.style, {
      display: "block",
      top: r.top + "px",
      left: r.left + "px",
      width: r.width + "px",
      height: r.height + "px",
    });
    tip.textContent =
      label || `<${target.tagName.toLowerCase()}>  ${Math.round(r.width)}×${Math.round(r.height)}`;
    tip.style.display = "block";
    // Đi lên tới thẻ bọc cao hơn màn hình thì r.top âm — không ghìm lại là
    // tooltip bay ra ngoài đúng lúc cần nó nhất.
    const ty = r.top > 26 ? r.top - 24 : r.bottom + 4;
    tip.style.top = Math.min(Math.max(4, ty), window.innerHeight - 22) + "px";
    tip.style.left = Math.min(Math.max(4, r.left), window.innerWidth - 220) + "px";
  }

  // ────────────────────────────────────────── đi chuyển bằng phím mũi tên

  /** Element đang chọn khi ô ghi chú mở. null = không ở chế độ điều hướng. */
  let navEl = null;
  /** Đường đã đi lên, để ↓ quay lại đúng chỗ vừa rời chứ không rơi vào con đầu. */
  let navStack = [];
  /** Ô ghi chú tự vẽ lại selector mỗi lần đổi element. */
  let syncInput = null;

  /** Thẻ không bao giờ là thứ người QC muốn chọn. */
  const NAV_SKIP = /^(SCRIPT|STYLE|LINK|META|TEMPLATE|NOSCRIPT|TITLE|BASE|HEAD)$/;

  /**
   * Lọc anh em vô hình. Không phải tinh chỉnh cho đẹp mà là điều kiện để ←→
   * dùng được: đo thật trên tailwindcss.com có bậc 178 anh em thì 175 là thẻ
   * <script>, không lọc thì bấm → 176 lần mới gặp thứ nhìn thấy được.
   *
   * Dùng checkVisibility chứ KHÔNG dùng kích thước khung: container grid có lúc
   * trả về width 0 nhưng vẫn là thẻ bọc thật của cả trang, lọc theo khung là
   * giết nhầm nó.
   */
  function navVisible(el) {
    if (!el || el.nodeType !== 1 || el === host) return false;
    if (NAV_SKIP.test(el.tagName)) return false;
    if (typeof el.checkVisibility === "function") {
      return el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
    }
    const r = el.getBoundingClientRect();
    return r.width > 1 || r.height > 1;
  }

  /** Anh em cùng cha đã lọc rác. Luôn giữ lại chính nó để chỉ số không lệch. */
  function navSiblings(el) {
    const parent = el.parentElement;
    if (!parent) return [el];
    return [...parent.children].filter((c) => c === el || navVisible(c));
  }

  /** Còn lên được mấy bậc nữa trước khi chạm <body>. */
  function navRoom(el) {
    let n = 0;
    let node = el;
    while (node && node !== document.body) {
      n++;
      node = node.parentElement;
    }
    return n;
  }

  /**
   * Nhãn tooltip. Phần lớn thẻ bọc chiếm đúng chỗ của thẻ con nên bấm ↑ xong
   * khung xanh không đổi gì — đo trên tailwindcss.com là 3/7 bậc như vậy. Không
   * có con số nhảy theo thì người dùng tưởng phím liệt rồi bấm quá tay.
   */
  function navLabel(el) {
    const r = el.getBoundingClientRect();
    const sibs = navSiblings(el);
    const idx = sibs.indexOf(el) + 1;
    const rc = reactCache.get(el);
    // Trang production đã minify tên: nói thẳng ra, đừng để trống làm người QC
    // tưởng tính năng hỏng rồi đi soi lại extension.
    const rlabel = rc ? (rc.minified ? " · React (build đã minify tên)" : ` · <${rc.chain[0]}>`) : "";
    return (
      `<${el.tagName.toLowerCase()}> ${Math.round(r.width)}×${Math.round(r.height)}` +
      ` · ↑ còn ${navRoom(el)} · ←→ ${idx}/${sibs.length}` +
      // Tên component đắt hơn mọi con số còn lại: biết ngay phải mở file nào.
      rlabel
    );
  }

  /** Kéo element vào tầm nhìn, nhưng đừng giật màn hình khi không cần. */
  function navReveal(el) {
    const r = el.getBoundingClientRect();
    const vh = window.innerHeight;
    if (r.top >= 0 && r.bottom <= vh) return;          // đã thấy trọn
    if (r.height > vh && r.top < 0 && r.bottom > 0) return; // to hơn màn hình, đang phủ kín
    el.scrollIntoView({ block: "center", inline: "nearest" });
  }

  function navSet(el) {
    if (!el) return false;
    navEl = el;
    navReveal(el);
    probeReact(el);
    drawHighlight(el, navLabel(el));
    if (syncInput) syncInput();
    return true;
  }

  function navUp() {
    if (!navEl || navEl === document.body) return false;
    const parent = navEl.parentElement;
    if (!parent || parent === document.documentElement) return false;
    navStack.push(navEl);
    return navSet(parent);
  }

  function navDown() {
    if (!navEl) return false;
    // Đường về của lần ↑ trước — ưu tiên tuyệt đối: ↑ rồi ↓ phải ra đúng chỗ cũ,
    // không phải rơi vào đứa con đầu tiên.
    while (navStack.length) {
      const back = navStack.pop();
      if (back !== navEl && back.isConnected && navEl.contains(back)) return navSet(back);
    }
    const kid = [...navEl.children].find(navVisible);
    return kid ? navSet(kid) : false;
  }

  function navSide(step) {
    if (!navEl) return false;
    const sibs = navSiblings(navEl);
    const next = sibs[sibs.indexOf(navEl) + step];
    if (!next) return false;   // tới biên thì dừng, không vòng lại cho khỏi lạc
    navStack = [];             // đi ngang xong thì "đường về" cũ hết nghĩa
    return navSet(next);
  }

  const NAV_MOVE = {
    ArrowUp: navUp,
    ArrowDown: navDown,
    ArrowLeft: () => navSide(-1),
    ArrowRight: () => navSide(1),
  };

  // ─────────────────────────────────────────────────────── ô nhập note

  let lastKind = "ui";

  /** Toàn bộ phím tắt — nguồn duy nhất cho bảng hiện khi rê vào dấu "?". */
  const SHORTCUTS = [
    ["Alt (giữ)", "soi element"],
    ["Alt + click", "chọn element, mở ô ghi chú"],
    ["↑ / ↓", "ra thẻ bọc ngoài / vào lại thẻ con vừa rời"],
    ["← / →", "anh em cùng cấp"],
    ["Enter · Tab", "nhảy vào ô gõ"],
    ["Alt + ↑↓←→", "đổi element cả khi đang gõ"],
    ["Cmd/Ctrl + Enter", "lưu ghi chú"],
    ["Esc", "đóng ô ghi chú / thoát soi"],
    ["Alt + Shift + A", "mở / đóng panel"],
    ["Alt + Shift + H", "tắt / bật overlay"],
  ];

  /**
   * Dấu "?" + bảng phím tắt. Giấu đi vì hai dòng gợi ý thường trực chiếm chỗ
   * trong ô ghi chú mà đọc một lần là thuộc — nhưng vẫn phải với tới được, và
   * lúc cần thì phải thấy ĐỦ phím chứ không chỉ mấy phím điều hướng.
   */
  function buildHelp() {
    const wrap = mk("div", { className: "help" });
    const mark = mk("button", {
      className: "qmark",
      type: "button",
      textContent: "?",
      tabIndex: -1, // Tab là phím nhảy vào ô gõ, đừng để nó dừng ở đây
      title: "Phím tắt",
    });
    const keys = mk("div", { className: "keys" });
    for (const [key, desc] of SHORTCUTS) {
      const row = mk("div", { className: "krow" });
      row.append(mk("kbd", { textContent: key }), mk("span", { textContent: desc }));
      keys.appendChild(row);
    }

    // Mở lên trên; hết chỗ thì lật xuống dưới. Đo sau khi hiện vì lúc đang ẩn
    // thì offsetHeight bằng 0. Không chừa khe giữa nút và bảng để rê chuột vào
    // bảng đọc kỹ được mà nó không tắt.
    wrap.onmouseenter = () => {
      keys.style.display = "block";
      const r = mark.getBoundingClientRect();
      const h = keys.offsetHeight;
      const above = r.top - h;
      const top = above >= 4 ? above : Math.min(r.bottom, window.innerHeight - h - 4);
      keys.style.top = Math.max(4, top) + "px";
      keys.style.left =
        Math.min(Math.max(4, r.left - 10), window.innerWidth - keys.offsetWidth - 4) + "px";
    };
    wrap.onmouseleave = () => (keys.style.display = "none");

    wrap.append(mark, keys);
    return wrap;
  }

  /** Đóng ô ghi chú và bỏ luôn trạng thái điều hướng — hai thứ này sống chết
   *  cùng nhau, tách ra là có đường để phím mũi tên còn ăn sau khi ô đã đóng. */
  function closeInput() {
    const wasEditing = editingId;
    root.querySelector("#input")?.remove();
    navEl = null;
    navStack = [];
    syncInput = null;
    editingId = null;
    hide(highlight, tip);
    // Bỏ nền xanh của dòng đang sửa trong panel.
    if (wasEditing) renderPanel();
  }

  /**
   * Ô ghi chú, dùng cho cả hai việc: tạo mới và sửa note cũ.
   *
   * @param {Element|null} target element để soi. `null` chỉ xảy ra khi sửa một
   *   note mà element của nó không còn trên trang (SPA render lại, hoặc note
   *   thuộc trang khác) — khi đó vẫn sửa được chữ, chỉ không đo lại được gì.
   * @param {Object|null} editing note đang sửa; `null` là tạo mới.
   */
  function openInput(target, x, y, editing) {
    root.querySelector("#input")?.remove();
    editingId = editing ? editing.id : null;
    const box = mk("div", { id: "input" });
    const meta = mk("code");
    const ta = mk("textarea", { placeholder: "Cần điều chỉnh gì ở đây? (Enter để vào ô này)" });
    if (editing) ta.value = editing.note;

    // Điều hướng bắt đầu từ đúng chỗ vừa click. Không focus ô gõ ngay: mũi tên
    // trần phải thuộc về việc chọn element, không phải di chuyển con trỏ chữ.
    navEl = target;
    navStack = [];
    syncInput = () => {
      if (navEl) meta.textContent = buildSelector(navEl);
    };
    if (target) {
      syncInput();
      probeReact(target);
      drawHighlight(target, navLabel(target));
    } else {
      // Giữ nguyên selector cũ trên màn hình: người sửa cần thấy mình đang sửa
      // đúng note nào, dù không soi lại được element.
      meta.textContent = editing ? editing.selector : "";
      box.appendChild(
        mk("div", {
          className: "warn",
          textContent:
            "Không tìm thấy element này trên trang đang mở — chỉ sửa được nội dung và loại. " +
            "Selector, class, CSS đang render giữ nguyên như lúc ghi.",
        })
      );
    }

    let kind = editing ? editing.kind : lastKind;
    const kinds = mk("div", { className: "kinds" });
    for (const k of AN.KINDS) {
      const b = mk("button", { textContent: k.label });
      if (k.id === kind) b.classList.add("on");
      b.onclick = () => {
        kind = k.id;
        [...kinds.children].forEach((c) => c.classList.toggle("on", c === b));
        ta.focus();
      };
      kinds.appendChild(b);
    }

    const actions = mk("div", { className: "actions" });
    const cancel = mk("button", { textContent: "Huỷ" });
    const ok = mk("button", {
      className: "primary",
      textContent: editing ? "Lưu thay đổi" : "Lưu ghi chú",
    });

    const commit = async () => {
      const text = ta.value.trim();
      // Xoá trắng nội dung khi đang sửa KHÔNG được ngầm hiểu là xoá note — muốn
      // xoá thì có nút × ngay cạnh. Bỏ trống thì coi như huỷ.
      if (!text) return closeInput();
      // Lưu element ĐANG chọn, không phải element đã click lúc đầu.
      const chosen = navEl;
      lastKind = kind;

      if (editing) {
        const i = notes.findIndex((x) => x.id === editing.id);
        if (i >= 0) {
          // Còn soi được element thì đo lại toàn bộ: người sửa rất hay vừa sửa
          // chữ vừa lái mũi tên sang khối khác cho trúng hơn. Không còn element
          // thì giữ nguyên mọi thứ đã đo, chỉ thay chữ và loại.
          const next = chosen
            ? captureNote(chosen, text, kind)
            : { ...notes[i], note: text, kind };
          // id và at giữ nguyên: id để panel không nhảy, at để thứ tự trong file
          // .md vẫn là thứ tự QC phát hiện, không phải thứ tự sửa lần cuối.
          next.id = notes[i].id;
          next.at = notes[i].at;
          next.editedAt = new Date().toISOString();
          notes[i] = next;
        }
      } else {
        notes.push(captureNote(chosen, text, kind));
      }

      const verb = editing ? "Đã cập nhật" : "Đã lưu";
      closeInput();
      await persist();
      renderFab();
      renderPanel();
      flash(verb + " · " + notes.length + " ghi chú");
    };

    ok.onclick = commit;
    cancel.onclick = closeInput;
    ta.onkeydown = (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) commit();
      if (e.key === "Escape") closeInput();
      e.stopPropagation();
    };

    actions.append(buildHelp(), cancel, ok);
    box.append(meta, ta, kinds, actions);
    root.appendChild(box);

    box.style.left = Math.min(x, window.innerWidth - 332) + "px";
    box.style.top = Math.min(y, window.innerHeight - 260) + "px";
  }

  // ───────────────────────────────────────────────────────────── events

  function setPicking(on) {
    picking = on;
    if (!on) hide(highlight, tip);
  }

  /**
   * Công tắc tổng. Tắt = giấu sạch overlay và ngưng nhận thao tác — Alt + click
   * rơi xuống trang như bình thường. Ghi chú đã lưu KHÔNG bị đụng tới.
   */
  async function applyEnabled(next, silent) {
    enabled = next;
    if (!enabled) {
      setPicking(false);
      togglePanel(false);
      closeInput();
    }
    fab.classList.toggle("off", !enabled);
    if (!silent) {
      await AN.setEnabled(enabled);
      flash(enabled ? "Đã bật ghi chú UI" : "Đã tắt — Alt+Shift+H để bật lại");
    }
  }

  /**
   * Bắt ở capture phase để LUÔN ăn, kể cả khi site chặn keydown ở bubble —
   * tắt rồi mà không bật lại được thì hỏng.
   * macOS: Option+Shift+H ra ký tự "Ó" nên so bằng e.code, không phải e.key.
   */
  document.addEventListener(
    "keydown",
    (e) => {
      if (!e.altKey || !e.shiftKey || e.code !== "KeyH") return;
      e.preventDefault();
      e.stopPropagation();
      applyEnabled(!enabled);
    },
    true
  );

  document.addEventListener("keydown", (e) => {
    if (!enabled) return;
    if (e.altKey && e.shiftKey && e.code === "KeyA") {
      e.preventDefault();
      togglePanel();
      return;
    }
    // Đang chọn element bằng phím thì Alt KHÔNG được bật lại chế độ soi, nếu
    // không chuột rung một cái là mousemove kéo highlight về dưới con trỏ.
    if (e.key === "Alt" && !navEl) setPicking(true);
    if (e.key === "Escape") {
      setPicking(false);
      // Esc đi từng nấc: đang mở ô ghi chú thì chỉ đóng ô đó. Đóng luôn cả panel
      // là mất chỗ vừa sửa dở, phải cuộn lại tìm từ đầu.
      if (root.querySelector("#input")) closeInput();
      else togglePanel(false);
    }
  });

  /**
   * Bắt ở capture phase vì trang có thể tự nuốt mũi tên (carousel, bảng, bản
   * đồ) — phải ăn trước. Nhưng khi con trỏ đang trong ô gõ note thì mũi tên
   * trần là di chuyển con trỏ chữ, chỉ Alt + mũi tên mới đổi element, để gõ
   * dở vẫn sửa được chỗ chọn mà không mất chữ.
   */
  document.addEventListener(
    "keydown",
    (e) => {
      if (!enabled || !navEl) return;
      const move = NAV_MOVE[e.key];
      if (!move) return;
      const typing = root.activeElement && root.activeElement.tagName === "TEXTAREA";
      if (typing && !e.altKey) return;
      e.preventDefault();
      e.stopPropagation();
      move();
    },
    true
  );

  /**
   * Chưa vào ô gõ mà bấm phím chữ thì nhảy vào ô luôn. KHÔNG preventDefault và
   * không tự chèn ký tự: bộ gõ tiếng Việt (Telex/VNI) phải được tự xử lý, cắt
   * ngang là hỏng dấu. Đường chính thức vẫn là Enter / Tab.
   */
  document.addEventListener(
    "keydown",
    (e) => {
      // navEl có thể null khi đang sửa note mà element không còn — ô gõ vẫn phải
      // nhận phím bình thường.
      if (!enabled || (!navEl && !editingId)) return;
      const ta = root.querySelector("#input textarea");
      if (!ta || root.activeElement === ta) return;
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();
        ta.focus();
        return;
      }
      if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) ta.focus();
    },
    true
  );

  document.addEventListener("keyup", (e) => {
    if (enabled && e.key === "Alt") setPicking(false);
  });

  window.addEventListener("blur", () => setPicking(false));

  document.addEventListener(
    "mousemove",
    (e) => {
      if (!enabled || !picking || navEl) return;
      const target = document.elementFromPoint(e.clientX, e.clientY);
      // Shadow DOM: mọi thứ của overlay đều trả về chính host → loại một phát.
      if (!target || target === host || target === hovered) return;
      hovered = target;
      drawHighlight(target);
    },
    true
  );

  document.addEventListener(
    "click",
    (e) => {
      // Tắt thì KHÔNG preventDefault — Alt + click phải rơi xuống trang như thường.
      if (!enabled || !e.altKey || e.target === host) return;
      e.preventDefault();
      e.stopPropagation();
      setPicking(false);
      openInput(e.target, e.clientX + 12, e.clientY + 12);
    },
    true
  );

  // Đi lên một <section> lớn là phải cuộn tới nó — mà cuộn lại chính là lúc
  // handler này trước đây tắt highlight, đúng khoảnh khắc cần nhìn thấy nhất.
  window.addEventListener(
    "scroll",
    () => {
      if (navEl) return drawHighlight(navEl, navLabel(navEl));
      hide(highlight, tip);
    },
    true
  );

  // SPA đổi route mà không reload: content script không hook được history của
  // trang (khác world), nên soi location theo nhịp — rẻ và không bao giờ trượt.
  setInterval(() => {
    if (location.pathname === currentPath) return;
    currentPath = location.pathname;
    renderFab();
    renderPanel();
  }, 400);

  // Tab khác ghi thêm note vào cùng origin → đồng bộ ngay.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    const key = AN.notesKey(ORIGIN);
    if (changes[key]) {
      notes = changes[key].newValue || [];
      renderFab();
      renderPanel();
    }
    if (changes[AN.ENABLED_KEY]) {
      applyEnabled(changes[AN.ENABLED_KEY].newValue !== false, true);
    }
  });

  // ──────────────────────────────────────────────────────────── khởi động

  (async () => {
    notes = await AN.getNotes(ORIGIN);
    enabled = await AN.getEnabled();
    renderFab();
    await applyEnabled(enabled, true);
    console.log(
      `%c[ui-annotate v${VERSION}]%c ` +
        (enabled
          ? "Alt + click để ghi chú · ↑↓←→ đổi element · Alt+Shift+A mở panel · Alt+Shift+H tắt overlay · "
          : "Overlay đang TẮT — Alt+Shift+H để bật lại · ") +
        `${notes.length} ghi chú đang lưu cho ${ORIGIN}`,
      "background:#2563eb;color:#fff;padding:2px 6px;border-radius:3px",
      "color:#64748b"
    );
  })();
})();

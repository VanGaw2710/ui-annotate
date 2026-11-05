/**
 * content.js — overlay ghi chú UI, chạy trên mọi website.
 *
 * Khác bản annotate.js cũ ở ba điểm:
 *  1. Không cần nhúng vào source site — extension tự bơm vào mọi trang.
 *  [ZEN-KAIZ-DS] Bản nhúng sẵn trong source, port từ extension v2.6: chrome.storage → UIAStore (store.js, localStorage),
 *  nạp bởi src/components/docs/UiAnnotate.tsx. Phần còn lại giữ nguyên bản gốc.
 *  2. Note lưu theo ORIGIN trong chrome.storage → chuyển trang / F5 / mở tab mới
 *     vẫn là một kho duy nhất, export ra một file .md cho cả website.
 *  3. Toàn bộ UI nằm trong Shadow DOM → CSS của site không phá được overlay.
 *
 * PHÍM TẮT
 *    A               bật / tắt chế độ chọn thẻ (bỏ qua khi đang gõ chữ ở bất kỳ đâu)
 *    A → click       chọn element, mở ô ghi chú (không cần giữ phím nào)
 *    Alt (giữ)       bật chế độ soi element
 *    Alt + click     chọn element, mở ô ghi chú
 *    ↑ / ↓           ra thẻ bọc ngoài / vào lại thẻ con vừa rời
 *    ← / →           anh em cùng cấp (đã lọc bỏ <script> và thẻ vô hình)
 *    Enter, Tab      nhảy vào ô gõ note
 *    Alt + ↑↓←→      đổi element cả khi con trỏ đang trong ô gõ
 *    Cmd/Ctrl+Enter  lưu note đang gõ
 *    Esc             thoát soi / đóng ô ghi chú / đóng panel
 *    Alt + Shift + A mở / đóng panel
 *    Alt + Shift + H tắt / bật overlay (nhớ qua reload, dùng chung mọi site) —
 *                    bật lại là hiện luôn ghim các chỗ đã ghi chú
 *    Alt + Shift + M ẩn / hiện ghim đánh dấu các chỗ đã ghi chú
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
  const VERSION = UIAStore.VERSION;

  /** @type {Array<Object>} */
  let notes = [];
  let enabled = true;
  let picking = false;
  /** Chế độ chọn thẻ bật bằng phím A — dính cho tới khi click chọn, A lần nữa, hoặc Esc.
   *  Tách khỏi `picking` vì Alt là kiểu giữ-thả: nhả Alt không được tắt cái này. */
  let pickLatch = false;
  /** Hiện ghim đánh dấu các chỗ đã ghi chú trên trang đang mở. */
  let markersOn = true;
  /** Vị trí chuột cuối cùng: bấm A là vẽ highlight ngay, khỏi đợi rung chuột. */
  let lastMouse = null;
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
  // [ZEN-KAIZ-DS] thêm data-ui-annotate-probe: dấu tạm của probe, lưu nhanh trước khi probe trả lời thì bị lọt vào .md
const ATTR_SKIP = /^(class|style|src|srcset|sizes|xmlns|viewbox|d|points|fill|stroke|on[a-z]+|data-ui-annotate-probe)$/i;

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

  function capture(el, text, kind, ds) {
    const rect = el.getBoundingClientRect();
    return {
      id: Date.now() + "-" + Math.random().toString(36).slice(2, 7),
      note: text,
      kind,
      // [ZEN-KAIZ-DS] v2.8 — true: AI phải sửa component DS gốc + ghi lý do & rule mới, không vá tại trang.
      ds: !!ds,
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
  function captureNote(el, text, kind, ds) {
    const n = capture(el, text, kind, ds);
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

  // [ZEN-KAIZ-DS] v2.7 bỏ "Tải .md" — Copy .md là đủ (dán thẳng cho Claude Code)

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
    "font: 13px/1.45 var(--font-sans, Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif) !important",
    "color: var(--color-content-neutral-strongest, #0d0d0d) !important",
  ].join("; ");
  const root = host.attachShadow({ mode: "open" });
  document.documentElement.appendChild(host);

  /**
   * v2.6 — popup `<dialog>` mở bằng showModal() nằm ở TOP LAYER (đè mọi z-index) và biến
   * mọi thứ ngoài nó thành inert: overlay gắn ở <html> bị che + không bấm / gõ được.
   * Cách gỡ: dialog modal nào đang mở thì dời host VÀO trong dialog trên cùng — host thành
   * con cháu của dialog nên hết inert, z-index tối đa trong dialog nên đè được nội dung popup.
   * Dialog đóng / bị gỡ khỏi DOM thì trả host về <html>. Host vẫn `position: fixed` theo
   * viewport (dialog không có transform). Dialog có transform (hiệu ứng) thì toạ độ lệch —
   * ghi trong README.
   */
  function topModalDialog() {
    const open = document.querySelectorAll("dialog[open]");
    for (let i = open.length - 1; i >= 0; i--) {
      try {
        if (open[i].matches(":modal")) return open[i];
      } catch (_) {
        return null; // trình duyệt chưa hỗ trợ :modal
      }
    }
    return null;
  }
  function placeHost() {
    const parent = topModalDialog() || document.documentElement;
    if (host.parentNode !== parent) parent.appendChild(host);
  }
  let placeQueued = false;
  new MutationObserver(() => {
    if (placeQueued) return;
    placeQueued = true;
    requestAnimationFrame(() => {
      placeQueued = false;
      placeHost();
    });
  }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["open"] });
  /** Overlay đang nằm trong dialog modal — Esc của overlay phải nuốt, không thì đóng luôn popup của trang */
  const inModal = () => host.parentNode !== document.documentElement;

  const style = document.createElement("style");
  style.textContent = `
    /* [ZEN-KAIZ-DS] v2.7 — giao diện overlay theo ZEN Kaiz Design System (màu · bo · bóng · motion · Inter). */
    :host, * { box-sizing: border-box; }
    /* Palette ZEN Kaiz ĐÓNG GÓI SẴN (giá trị token đã resolve từ tokens.css, Neutral Emphasis) — overlay tự có
       Light/Dark riêng, không phụ thuộc trang đang soi (bản extension chạy trên mọi site không có token ZEN).
       Theme do JS gắn lên host: data-uia-theme = light | dark (chế độ "Tự động" theo trang / hệ điều hành). */
    :host, :host([data-uia-theme="light"]) {
      --u-surface: #ffffff;
      --u-popover: #ffffffe5;
      --u-line: #01010110;
      --u-divider: #01010110;
      --u-text: #0d0d0d;
      --u-text-2: #000000a3;
      --u-text-3: #00000081;
      --u-subtle: #01010110;
      --u-subtle-hover: #02020215;
      --u-pale: #05050508;
      --u-solid: #0d0d0d;
      --u-on-solid: #f5f5f5;
      --u-accent: #f263ca;
      --u-accent-line: #f263ca;
      --u-accent-subtle: #ff029816;
      --u-on-accent: #ffffff;
      --u-primary: #0d0d0d;
      --u-primary-hover: #5c5c5c;
      --u-on-primary: #f5f5f5;
      --u-ter: #ffffff;
      --u-ter-hover: #05050508;
      --u-ter-fg: #0d0d0d;
      --u-ter-line: #0101011d;
      --u-neg: #e5532e;
      --u-neg-subtle: #ff350219;
      --u-neg-text: #d03e19;
      --u-pos: #3fab53;
      --u-pos-subtle: #01b40922;
      --u-pos-text: #259842;
      --u-warn: #ffba1a;
      --u-warn-subtle: #ff9e012f;
      --u-warn-text: #946b00;
      --u-info: #0a85ff;
      --u-info-subtle: #0267ff19;
      --u-info-text: #0074e0;
      --u-input: #05050508;
      --u-input-line: #0101011d;
      --u-focus: #0d0d0d;
      --u-ring: #01010124;
      --u-shadow: 0px 12px 32px -16px #0000000a, 0px 8px 24px -12px #00000014;
      --u-shadow-sm: 0px 1px 1px 0px #0000000a;
      --u-shadow-2: 0px 12px 40px -16px #0000001f, 0px 4px 16px -8px #00000029, 0px 0px 2px 0px #0000000a;
      --u-placeholder: #00000044;
      --u-on-brights: #000000db;
      --u-focus-ring: #0101012f;
      --u-scroll: #01010124;
      --u-scroll-hover: #00000044;
    }
    :host([data-uia-theme="dark"]) {
      --u-surface: #191919;
      --u-popover: #242424e6;
      --u-line: #fcfcfc11;
      --u-divider: #fcfcfc11;
      --u-text: #f5f5f5;
      --u-text-2: #ffffffcb;
      --u-text-3: #ffffff8e;
      --u-subtle: #fcfcfc11;
      --u-subtle-hover: #ffffff1a;
      --u-pale: #fcfcfc09;
      --u-solid: #f5f5f5;
      --u-on-solid: #0d0d0d;
      --u-accent: #f263ca;
      --u-accent-line: #f263ca;
      --u-accent-subtle: #ff59cc20;
      --u-on-accent: #ffffff;
      --u-primary: #f5f5f5;
      --u-primary-hover: #cecece;
      --u-on-primary: #0d0d0d;
      --u-ter: #191919;
      --u-ter-hover: #fcfcfc09;
      --u-ter-fg: #f5f5f5;
      --u-ter-line: #fdfdfd20;
      --u-neg: #e5532e;
      --u-neg-subtle: #ff5e2e21;
      --u-neg-text: #fb6743;
      --u-pos: #3fab53;
      --u-pos-subtle: #4dfd6515;
      --u-pos-text: #53be66;
      --u-warn: #ffba1a;
      --u-warn-subtle: #ff82001d;
      --u-warn-text: #ffc759;
      --u-info: #0a85ff;
      --u-info-subtle: #2389fe24;
      --u-info-text: #499bff;
      --u-input: #fcfcfc09;
      --u-input-line: #fdfdfd20;
      --u-focus: #f5f5f5;
      --u-ring: #ffffff2a;
      --u-shadow: 0px 12px 32px -16px #00000029, 0px 8px 24px -12px #0000003d;
      --u-shadow-sm: 0px 1px 1px 0px #00000029;
      --u-shadow-2: 0px 12px 40px -16px #0000005c, 0px 4px 16px -8px #00000070, 0px 0px 2px 0px #00000029;
      --u-placeholder: #ffffff55;
      --u-on-brights: #000000db;
      --u-focus-ring: #ffffff39;
      --u-scroll: #ffffff2a;
      --u-scroll-hover: #ffffff55;
    }
    :host {
      --u-r-lg: var(--radius-2xl, 24px);
      --u-r: var(--radius-base, 12px);
      --u-r-sm: var(--radius-sm, 8px);
      --u-r-xs: var(--radius-xs, 4px);
      --u-ease: var(--ease-standard, cubic-bezier(.2,0,0,1));
      --u-spring: var(--ease-spring, cubic-bezier(.34,1.56,.64,1));
      --u-fast: var(--motion-fast, 200ms);
      --u-slow: var(--motion-slow, 450ms);
      --u-mono: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
      font: 13px/1.45 var(--font-sans, Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif);
      letter-spacing: -0.01em;
      color: var(--u-text);
      -webkit-font-smoothing: antialiased;
    }
    button { font: inherit; letter-spacing: inherit; }
    button:focus-visible, textarea:focus-visible { outline: 3px solid var(--u-focus-ring); outline-offset: 3px; }
    @keyframes u-in { from { opacity: 0; transform: translateY(8px) scale(.96); } to { opacity: 1; transform: none; } }
    @keyframes u-pop { 0% { transform: scale(.4); } 35% { transform: scale(1.16,.88); } 55% { transform: scale(.93,1.07); } 72% { transform: scale(1.03,.98); } 100% { transform: scale(1); } }

    #highlight {
      position: fixed; pointer-events: none;
      border: 2px solid var(--u-accent-line); background: var(--u-accent-subtle);
      border-radius: var(--u-r-xs); transition: all var(--motion-instant, 120ms) var(--u-ease);
    }
    #tip {
      position: fixed; pointer-events: none;
      background: var(--u-solid); color: var(--u-on-solid); padding: 4px 8px;
      border-radius: var(--u-r-sm); font-size: 11px; white-space: nowrap; letter-spacing: 0;
      font-family: var(--u-mono); box-shadow: var(--u-shadow-sm);
    }

    #fab {
      position: fixed; right: 16px; bottom: 16px; pointer-events: auto;
      display: flex; align-items: center; gap: 8px; height: 40px;
      background: var(--u-primary); color: var(--u-on-primary); border: 0;
      padding: 0 8px 0 16px; border-radius: 999px; cursor: pointer; font-weight: 600;
      box-shadow: var(--u-shadow-2);
      transition: transform var(--u-slow) var(--u-spring), background-color var(--u-fast) var(--u-ease);
    }
    #fab:hover { background: var(--u-primary-hover); }
    #fab:active { transform: scale(.97,.92); transition-duration: var(--motion-instant, 120ms); }
    #fab b {
      min-width: 24px; height: 24px; display: inline-flex; align-items: center; justify-content: center;
      background: var(--u-accent); color: var(--u-on-accent); border-radius: 999px; padding: 0 7px; font-size: 11px;
    }
    #fab.off { display: none; }
    #fab.picking { background: var(--u-accent); color: var(--u-on-accent); }
    #fab.picking b { background: var(--u-primary); color: var(--u-on-primary); }

    /* Ghim đánh dấu chỗ đã ghi chú. Hình giọt nước, mũi nhọn chỉ đúng góc trên-trái
       của element — cùng kiểu comment pin của các tool design. */
    #pins { position: fixed; inset: 0; pointer-events: none; }
    .pin {
      position: fixed; pointer-events: auto; cursor: pointer;
      min-width: 24px; height: 24px; padding: 0 7px;
      border-radius: 12px 12px 12px 3px; border: 2px solid var(--u-surface);
      background: var(--u-info); color: #fff; font-size: 11px; font-weight: 600; line-height: 20px;
      text-align: center; box-shadow: var(--u-shadow-sm);
      transform-origin: 0 100%; animation: u-pop var(--u-slow) var(--u-ease) both;
      transition: transform var(--u-slow) var(--u-spring);
    }
    .pin:hover, .pin.on { transform: scale(1.15); z-index: 1; }
    .pin.copy { background: var(--u-pos); }
    .pin.flow { background: var(--u-warn); color: var(--u-on-brights); }
    .pin.bug  { background: var(--u-neg); }
    /* Đang soi / chọn thẻ: ghim trong suốt với chuột để chọn được element nằm dưới. */
    #pins.passive .pin { pointer-events: none; opacity: .45; }

    #panel {
      position: fixed; right: 16px; bottom: 68px; pointer-events: auto;
      width: 380px; max-width: calc(100vw - 32px); max-height: 66vh; display: flex; flex-direction: column;
      background: var(--u-popover); color: var(--u-text); border: 1px solid var(--u-line);
      -webkit-backdrop-filter: blur(var(--blur-popover, 24px)); backdrop-filter: blur(var(--blur-popover, 24px));
      border-radius: var(--u-r-lg); box-shadow: var(--u-shadow); overflow: hidden;
      transform-origin: 100% 100%; animation: u-in var(--u-slow) var(--u-spring) both;
    }
    #panel header { padding: 12px 12px 10px; border-bottom: 1px solid var(--u-divider); }
    #panel .row { display: flex; gap: 6px; align-items: center; }
    #panel .row + .row { margin-top: 10px; }
    #panel strong { flex: 1; font-size: 13px; font-weight: 600; padding-left: 4px; }
    .tabs { display: flex; gap: 2px; background: var(--u-subtle); padding: 2px; border-radius: 999px; }
    .tabs button {
      border: 0; background: none; color: var(--u-text-3); cursor: pointer; font-weight: 500;
      padding: 0 12px; height: 28px; border-radius: 999px; font-size: 12px;
      transition: background-color var(--u-fast) var(--u-ease), color var(--u-fast) var(--u-ease);
    }
    .tabs button:hover { color: var(--u-text); }
    .tabs button.on { background: var(--u-surface); color: var(--u-text); box-shadow: var(--u-shadow-sm); }
    #panel .row .pinsBtn { margin-left: auto; }
    button.act.icon { width: 28px; padding: 0; display: inline-flex; align-items: center; justify-content: center; }
    button.act.icon svg { width: 16px; height: 16px; fill: currentColor; animation: u-pop var(--u-slow) var(--u-ease) both; }
    button.act {
      height: 28px; padding: 0 12px; cursor: pointer; font-size: 12px; font-weight: 600; white-space: nowrap;
      border: 1px solid var(--u-ter-line); background: var(--u-ter); color: var(--u-ter-fg);
      border-radius: 999px; box-shadow: var(--u-shadow-sm);
      transition: transform var(--u-slow) var(--u-spring), background-color var(--u-fast) var(--u-ease), color var(--u-fast) var(--u-ease);
    }
    button.act:hover { background: var(--u-ter-hover); }
    button.act:active, .item .del:active, .item .edit:active, #input .actions button:active, #input .kinds button:active {
      transform: scale(.97,.92); transition-duration: var(--motion-instant, 120ms);
    }
    button.act.danger:hover { background: var(--u-neg-subtle); border-color: transparent; color: var(--u-neg-text); }
    button.act.danger.armed { background: var(--u-neg); border-color: var(--u-neg); color: #fff; }

    #list { overflow: auto; flex: 1; min-height: 0; padding: 4px; }

    /* [ZEN-KAIZ-DS] v2.8 — scrollbar overlay: ẩn scrollbar gốc (chiếm chỗ, kiểu Windows), thay bằng thumb
       nổi đè lên nội dung, chỉ hiện khi cuộn / rê chuột. Cùng màu Border/Neutral/Subtle/Pressed như
       scrollbar floating của ZEN-KAIZ-DS. */
    .oscroll { position: relative; display: flex; flex-direction: column; min-height: 0; }
    #panel > .oscroll { flex: 1; }
    .oscroll > .oview { scrollbar-width: none; }
    .oscroll > .oview::-webkit-scrollbar { display: none; width: 0; height: 0; }
    .otrack { position: absolute; top: 4px; bottom: 4px; right: 2px; width: 10px; pointer-events: none; }
    .othumb {
      position: absolute; right: 2px; top: 0; width: 4px; min-height: 24px; border-radius: 999px;
      background: var(--u-scroll); opacity: 0; pointer-events: auto; cursor: default;
      transition: opacity var(--u-fast) var(--u-ease), width var(--u-fast) var(--u-ease), background-color var(--u-fast) var(--u-ease);
    }
    .oscroll.can:hover .othumb, .oscroll.show .othumb, .othumb.drag { opacity: 1; }
    .othumb:hover, .othumb.drag { width: 6px; background: var(--u-scroll-hover); }
    .oscroll:not(.can) .otrack { display: none; }
    .group { padding: 10px 10px 4px; font-size: 11px; color: var(--u-text-3); letter-spacing: 0;
      font-family: var(--u-mono); }
    .item { padding: 10px; border-radius: var(--u-r); transition: background-color var(--u-fast) var(--u-ease); }
    .item + .item { margin-top: 2px; }
    .item:hover { background: var(--u-pale); }
    .item p { margin: 0 0 4px; font-weight: 500; color: var(--u-text); }
    .item code { font-size: 11px; color: var(--u-text-3); word-break: break-all; letter-spacing: 0;
      font-family: var(--u-mono); }
    .item .num { display: inline-block; min-width: 18px; margin-right: 6px; font-size: 10px;
      font-weight: 600; color: var(--u-on-solid); background: var(--u-solid); border-radius: 9px 9px 9px 2px;
      text-align: center; padding: 1px 4px; vertical-align: 1px; }
    .item .del, .item .edit { float: right; width: 24px; height: 24px; border: 0; background: none; cursor: pointer;
      color: var(--u-text-3); padding: 0; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center;
      transition: transform var(--u-slow) var(--u-spring), background-color var(--u-fast) var(--u-ease), color var(--u-fast) var(--u-ease); }
    .item .del svg { width: 16px; height: 16px; fill: currentColor; }
    .item .edit svg { width: 14px; height: 14px; fill: currentColor; }
    .item .edit { margin-right: 2px; }
    .item .del:hover { color: var(--u-neg-text); background: var(--u-neg-subtle); }
    .item .edit:hover { color: var(--u-text); background: var(--u-subtle); }
    .item.editing { background: var(--u-accent-subtle); }
    .kind { display: inline-block; font-size: 10px; font-weight: 500; padding: 1px 7px; border-radius: 999px;
      background: var(--u-info-subtle); color: var(--u-info-text); margin-right: 6px; vertical-align: 1px; }
    .kind.copy { background: var(--u-pos-subtle); color: var(--u-pos-text); }
    .kind.flow { background: var(--u-warn-subtle); color: var(--u-warn-text); }
    .kind.bug  { background: var(--u-neg-subtle); color: var(--u-neg-text); }
    .kind.ds   { background: var(--u-accent-subtle); color: var(--u-text); }
    #empty { padding: 28px 16px; color: var(--u-text-3); text-align: center; }

    #input {
      position: fixed; pointer-events: auto; width: 340px;
      background: var(--u-popover); border: 1px solid var(--u-line); color: var(--u-text);
      -webkit-backdrop-filter: blur(var(--blur-popover, 24px)); backdrop-filter: blur(var(--blur-popover, 24px));
      border-radius: var(--u-r-lg); box-shadow: var(--u-shadow); padding: 14px;
      animation: u-in var(--u-slow) var(--u-spring) both;
    }
    /* Sửa note cũ mà element không còn trên trang: nói rõ cái gì sẽ đổi, cái gì
       giữ nguyên. Không có dòng này thì người dùng tưởng bấm Lưu là đo lại hết. */
    #input .warn { font-size: 11px; line-height: 1.45; color: var(--u-warn-text); background: var(--u-warn-subtle);
      border-radius: var(--u-r-sm); padding: 8px 10px; margin-bottom: 10px; }
    #input code { display: block; font-size: 11px; color: var(--u-text-3); margin-bottom: 10px; letter-spacing: 0;
      word-break: break-all; font-family: var(--u-mono); }
    #input .oscroll { width: 100%; }
    #input textarea {
      display: block; width: 100%; height: 84px; resize: vertical; padding: 10px 12px; color: var(--u-text);
      background: var(--u-input); border: 1px solid var(--u-input-line); border-radius: var(--u-r); font: inherit;
      box-shadow: var(--u-shadow-sm); outline: none;
      transition: border-color var(--u-fast) var(--u-ease), box-shadow var(--u-fast) var(--u-ease);
    }
    #input textarea::placeholder { color: var(--u-placeholder); }
    #input textarea:focus { border-color: var(--u-focus); box-shadow: 0 0 0 3px var(--u-ring); }
    #input .kinds { display: flex; gap: 6px; margin-top: 10px; flex-wrap: wrap; align-items: center; }

    /* [ZEN-KAIZ-DS] v2.8 — Checkbox "Update DS" theo ZEN Checkbox: mark 16px bo 4, viền Neutral/Subtle,
       chọn = nền Neutral/Solid + tick vẽ (stroke-dashoffset) + pop nảy, halo hover 32px. */
    #input .dsrow { display: flex; align-items: flex-start; gap: 8px; margin-top: 12px; cursor: pointer; user-select: none; }
    #input .dsrow input { position: absolute; opacity: 0; width: 1px; height: 1px; margin: 0; pointer-events: none; }
    #input .dsmark { position: relative; flex: 0 0 16px; width: 16px; height: 16px; margin-top: 1px; }
    #input .dsmark::before {
      content: ""; position: absolute; left: 50%; top: 50%; width: 32px; height: 32px; margin: -16px 0 0 -16px;
      border-radius: 999px; background: var(--u-ter-hover); opacity: 0; transform: scale(.5);
      transition: transform var(--motion-base, 300ms) var(--u-spring), opacity var(--motion-base, 300ms) var(--u-ease);
    }
    #input .dsrow:hover .dsmark::before { opacity: 1; transform: scale(1); }
    #input .dsbox {
      position: absolute; inset: 0; border-radius: var(--u-r-xs); border: 1px solid var(--u-ter-line);
      background: transparent; color: var(--u-on-solid); display: flex; align-items: center; justify-content: center;
      transition: background-color var(--motion-base, 300ms) var(--u-spring), border-color var(--motion-base, 300ms) var(--u-spring);
    }
    #input .dsrow:hover .dsbox { border-color: var(--u-text-3); }
    #input .dsbox svg { width: 75%; height: 75%; stroke-dasharray: 14; stroke-dashoffset: 14;
      transition: stroke-dashoffset var(--motion-base, 300ms) var(--u-ease); }
    #input .dsrow input:checked + .dsmark .dsbox { background: var(--u-solid); border-color: transparent; animation: u-pop var(--u-slow) var(--u-ease) both; }
    #input .dsrow:hover input:checked + .dsmark .dsbox { background: var(--u-primary-hover); }
    #input .dsrow input:checked + .dsmark .dsbox svg { stroke-dashoffset: 0; }
    #input .dsrow input:focus-visible + .dsmark .dsbox { outline: 3px solid var(--u-focus-ring); outline-offset: 3px; }
    #input .dstext { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    #input .dstext b { font-weight: 500; font-size: 13px; color: var(--u-text); }
    #input .dstext span { font-size: 11px; line-height: 1.4; color: var(--u-text-3); }

    #input .help { position: relative; margin-right: auto; display: flex; }
    #input .qmark {
      width: 24px; height: 24px; padding: 0; border-radius: 999px; line-height: 1;
      border: 1px solid var(--u-ter-line); background: var(--u-ter); color: var(--u-text-3);
      font-size: 11px; font-weight: 600; cursor: help;
      display: flex; align-items: center; justify-content: center;
      transition: background-color var(--u-fast) var(--u-ease), color var(--u-fast) var(--u-ease);
    }
    #input .help:hover .qmark { background: var(--u-solid); border-color: var(--u-solid); color: var(--u-on-solid); }
    /* position: fixed — chỗ đặt do JS tính, vì ô ghi chú có thể mở sát mép trên
       màn hình (rất hay xảy ra khi ghi chú header) và bảng sẽ bị cắt cụt. */
    #input .keys {
      display: none; position: fixed; width: 296px; z-index: 1;
      background: var(--u-solid); color: var(--u-on-solid); border-radius: var(--u-r); padding: 10px 12px;
      box-shadow: var(--u-shadow);
    }
    #input .krow { display: flex; gap: 10px; align-items: baseline; padding: 2px 0; font-size: 11px; }
    #input .krow kbd {
      flex: 0 0 104px; text-align: right; white-space: nowrap; letter-spacing: 0;
      font-family: var(--u-mono); font-size: 10.5px;
    }
    #input .krow span { opacity: .7; }
    #input .kinds button {
      height: 28px; border: 1px solid var(--u-ter-line); background: var(--u-ter); color: var(--u-text-2);
      border-radius: 999px; padding: 0 12px; cursor: pointer; font-size: 12px; font-weight: 500;
      transition: transform var(--u-slow) var(--u-spring), background-color var(--u-fast) var(--u-ease), color var(--u-fast) var(--u-ease);
    }
    #input .kinds button:hover { background: var(--u-ter-hover); }
    #input .kinds button.on { background: var(--u-solid); border-color: var(--u-solid); color: var(--u-on-solid); }
    #input .actions { display: flex; gap: 8px; justify-content: flex-end;
      align-items: center; margin-top: 12px; }
    #input .actions button { height: 32px; border-radius: 999px; padding: 0 14px; cursor: pointer;
      font-size: 12px; font-weight: 600; border: 1px solid var(--u-ter-line); background: var(--u-ter); color: var(--u-ter-fg);
      box-shadow: var(--u-shadow-sm);
      transition: transform var(--u-slow) var(--u-spring), background-color var(--u-fast) var(--u-ease); }
    #input .actions button:hover { background: var(--u-ter-hover); }
    #input .actions button.primary { background: var(--u-primary); border-color: var(--u-primary); color: var(--u-on-primary); }
    #input .actions button.primary:hover { background: var(--u-primary-hover); }

    #flash {
      position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%);
      background: var(--u-solid); color: var(--u-on-solid); padding: 0 16px; height: 36px;
      display: flex; align-items: center; font-weight: 500;
      border-radius: 999px; font-size: 12px; pointer-events: none; box-shadow: var(--u-shadow);
      animation: u-in var(--u-slow) var(--u-spring) both;
    }
  `;
  root.appendChild(style);

  // ───────────────────────────────────── [ZEN-KAIZ-DS] v2.7 · Light / Dark của overlay
  //
  // 3 chế độ, lưu chung mọi site như các công tắc khác:
  //   auto  — theo trang: <html data-theme="dark"> (ZEN Kaiz DS) hoặc class "dark" (Tailwind / shadcn),
  //           trang không khai báo thì theo hệ điều hành (prefers-color-scheme)
  //   light / dark — ép cố định
  const ICON_DEL = "<svg viewBox=\"0 0 20 20\" aria-hidden=\"true\"><path fill-rule=\"evenodd\" d=\"M8.82 10L4.17 5.35L5.35 4.17L10 8.82L14.65 4.17L15.83 5.35L11.18 10L15.83 14.65L14.65 15.83L10 11.18L5.35 15.83L4.17 14.65L8.82 10Z\"/></svg>";
  const ICON_EDIT = "<svg viewBox=\"0 0 20 20\" aria-hidden=\"true\"><path d=\"M12.84 2.61C14.1 1.35 16.13 1.35 17.39 2.61C18.65 3.87 18.65 5.9 17.39 7.16L8.14 16.41C8.05 16.5 7.94 16.57 7.82 16.61L2.77 18.29C2.47 18.39 2.14 18.31 1.91 18.09C1.69 17.86 1.61 17.53 1.71 17.23L3.39 12.18C3.43 12.06 3.5 11.95 3.59 11.86L12.84 2.61ZM3.84 16.16L5.99 15.44L4.56 14.01L3.84 16.16ZM16.2 3.8C15.6 3.2 14.63 3.2 14.03 3.8L5.38 12.45L7.55 14.62L16.2 5.97C16.8 5.37 16.8 4.4 16.2 3.8Z\"/></svg>";
  const THEME_NEXT = { auto: "light", light: "dark", dark: "auto" };
  const THEME_LABEL = { auto: "Giao diện: Tự động", light: "Giao diện: Sáng", dark: "Giao diện: Tối" };
  const THEME_ICON = { auto: "<svg viewBox=\"0 0 20 20\" aria-hidden=\"true\"><path d=\"M15.83 1.67C17.67 1.67 19.17 3.16 19.17 5L19.17 11.67C19.17 13.51 17.67 15 15.83 15L10.83 15L10.83 16.67L13.33 16.67L13.33 18.33L6.67 18.33L6.67 16.67L9.17 16.67L9.17 15L4.17 15C2.33 15 0.83 13.51 0.83 11.67L0.83 5C0.83 3.16 2.33 1.67 4.17 1.67L15.83 1.67ZM4.17 3.33C3.25 3.33 2.5 4.08 2.5 5L2.5 11.67C2.5 12.59 3.25 13.33 4.17 13.33L15.83 13.33C16.75 13.33 17.5 12.59 17.5 11.67L17.5 5C17.5 4.08 16.75 3.33 15.83 3.33L4.17 3.33Z\"/></svg>", light: "<svg viewBox=\"0 0 20 20\" aria-hidden=\"true\"><path d=\"M10.83 19.17L9.17 19.17L9.17 17.5L10.83 17.5L10.83 19.17ZM5.29 15.89L4.11 17.07L2.93 15.89L4.11 14.71L5.29 15.89ZM17.07 15.89L15.89 17.07L14.71 15.89L15.89 14.71L17.07 15.89ZM10 4.17C13.22 4.17 15.83 6.78 15.83 10C15.83 13.22 13.22 15.83 10 15.83C6.78 15.83 4.17 13.22 4.17 10C4.17 6.78 6.78 4.17 10 4.17ZM10 5.83C7.7 5.83 5.83 7.7 5.83 10C5.83 12.3 7.7 14.17 10 14.17C12.3 14.17 14.17 12.3 14.17 10C14.17 7.7 12.3 5.83 10 5.83ZM2.5 10.83L0.83 10.83L0.83 9.17L2.5 9.17L2.5 10.83ZM19.17 10.83L17.5 10.83L17.5 9.17L19.17 9.17L19.17 10.83ZM17.07 4.11L15.89 5.29L14.71 4.11L15.89 2.93L17.07 4.11ZM5.29 4.11L4.11 5.29L2.93 4.11L4.11 2.93L5.29 4.11ZM10.83 2.5L9.17 2.5L9.17 0.83L10.83 0.83L10.83 2.5Z\"/></svg>", dark: "<svg viewBox=\"0 0 20 20\" aria-hidden=\"true\"><path d=\"M6.45 0.91C6.77 0.76 7.14 0.83 7.39 1.08C7.63 1.32 7.7 1.69 7.56 2.01C7.11 3 6.86 4.1 6.86 5.26C6.86 9.61 10.39 13.14 14.74 13.14C15.9 13.14 17 12.89 17.99 12.44C18.31 12.3 18.68 12.37 18.92 12.61C19.17 12.86 19.24 13.23 19.09 13.55C17.59 16.86 14.26 19.17 10.38 19.17C5.11 19.17 0.83 14.89 0.83 9.61C0.83 5.74 3.14 2.41 6.45 0.91ZM5.34 3.55C3.61 5 2.5 7.18 2.5 9.61C2.5 13.97 6.03 17.5 10.38 17.5C12.82 17.5 15 16.39 16.45 14.66C15.9 14.76 15.33 14.81 14.74 14.81C9.47 14.81 5.19 10.53 5.19 5.26C5.19 4.67 5.24 4.1 5.34 3.55Z\"/></svg>" };
  let themePref = "auto";
  const darkMq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  function pageTheme() {
    const html = document.documentElement;
    const attr = html.getAttribute("data-theme") || html.getAttribute("data-mode") || "";
    if (/dark/i.test(attr)) return "dark";
    if (/light/i.test(attr)) return "light";
    if (html.classList.contains("dark") || (document.body && document.body.classList.contains("dark"))) return "dark";
    if (html.classList.contains("light")) return "light";
    return darkMq && darkMq.matches ? "dark" : "light";
  }
  function applyTheme() {
    host.setAttribute("data-uia-theme", themePref === "auto" ? pageTheme() : themePref);
  }
  async function setThemePref(next) {
    themePref = next;
    applyTheme();
    renderPanel();
    flash(THEME_LABEL[next]);
    await AN.setTheme(next);
  }
  applyTheme();
  new MutationObserver(() => themePref === "auto" && applyTheme()).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme", "data-mode", "class"],
  });
  if (darkMq && darkMq.addEventListener) darkMq.addEventListener("change", () => themePref === "auto" && applyTheme());

  const highlight = mk("div", { id: "highlight" });
  const tip = mk("div", { id: "tip" });
  const fab = mk("button", { id: "fab" });
  const panel = mk("div", { id: "panel" });
  const pins = mk("div", { id: "pins" });
  hide(highlight, tip, panel);
  // Ghim nằm dưới cùng: highlight, ô ghi chú, panel luôn đè lên ghim.
  root.append(pins, highlight, tip, fab, panel);

  /**
   * [ZEN-KAIZ-DS] v2.8 — scrollbar overlay cho vùng cuộn trong overlay (danh sách panel, ô ghi chú).
   * Chrome đã bỏ `overflow: overlay`, còn scrollbar gốc ở chế độ "luôn hiện" (chuột thường, Windows)
   * chiếm 15px và đè lệch bố cục. Ẩn scrollbar gốc, vẽ thumb nổi: không chiếm chỗ, hiện khi cuộn /
   * rê chuột, kéo được. Trả về wrapper để gắn vào chỗ của `view`.
   */
  function overlayScroll(view) {
    const wrap = mk("div", { className: "oscroll" });
    const track = mk("div", { className: "otrack" });
    const thumb = mk("div", { className: "othumb" });
    view.classList.add("oview");
    track.appendChild(thumb);
    wrap.append(view, track);

    let hideT = 0;
    const update = () => {
      const { scrollHeight: sh, clientHeight: ch, scrollTop: st } = view;
      const can = sh > ch + 1;
      wrap.classList.toggle("can", can);
      if (!can) return;
      // Track bám đúng vùng nhìn thấy của view (textarea có viền / co giãn khác wrapper).
      track.style.top = view.offsetTop + 4 + "px";
      track.style.bottom = "auto";
      track.style.height = Math.max(0, ch - 8) + "px";
      const th = track.clientHeight;
      const h = Math.max(24, (ch / sh) * th);
      thumb.style.height = h + "px";
      thumb.style.transform = `translateY(${(st / (sh - ch)) * (th - h)}px)`;
    };
    view.addEventListener("scroll", () => {
      update();
      wrap.classList.add("show");
      clearTimeout(hideT);
      hideT = setTimeout(() => wrap.classList.remove("show"), 900);
    }, { passive: true });
    wrap.addEventListener("mouseenter", update);
    view.addEventListener("input", update);
    if (window.ResizeObserver) new ResizeObserver(update).observe(view);
    if (window.MutationObserver) new MutationObserver(update).observe(view, { childList: true, subtree: true });

    thumb.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const y0 = e.clientY;
      const st0 = view.scrollTop;
      const ratio = (view.scrollHeight - view.clientHeight) / Math.max(1, track.clientHeight - thumb.offsetHeight);
      thumb.classList.add("drag");
      thumb.setPointerCapture(e.pointerId);
      const move = (ev) => (view.scrollTop = st0 + (ev.clientY - y0) * ratio);
      const up = () => {
        thumb.classList.remove("drag");
        thumb.removeEventListener("pointermove", move);
        thumb.removeEventListener("pointerup", up);
        thumb.removeEventListener("pointercancel", up);
      };
      thumb.addEventListener("pointermove", move);
      thumb.addEventListener("pointerup", up);
      thumb.addEventListener("pointercancel", up);
    });
    requestAnimationFrame(update);
    return wrap;
  }

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
    fab.classList.toggle("picking", pickLatch);
    fab.append(
      mk("span", { textContent: pickLatch ? "Đang chọn thẻ · A / Esc để thoát" : "Ghi chú UI" }),
      mk("b", { textContent: String(notes.length) })
    );
    fab.title = `UI Annotate v${VERSION} · ${notesOfPage().length} ghi chú ở trang này · ${notes.length} toàn site`;
    // Mọi đường đổi notes / đổi route đều đi qua đây → ghim luôn khớp dữ liệu.
    schedulePins();
  }

  // ──────────────────────────────────────── ghim đánh dấu chỗ đã ghi chú

  /** id note → nút ghim. Giữ lại node giữa các lần vẽ: vẽ lại theo từng khung
   *  hình khi cuộn mà tạo node mới thì chuột đang rê trên ghim mất mouseleave. */
  const pinEls = new Map();
  let pinRaf = 0;

  function schedulePins() {
    if (pinRaf) return;
    pinRaf = requestAnimationFrame(() => {
      pinRaf = 0;
      renderPins();
    });
  }

  function renderPins() {
    pins.classList.toggle("passive", picking);
    const list = enabled && markersOn ? notesOfPage() : [];
    const alive = new Set();
    /** Nhiều note trên cùng một element: xếp ghim sau lệch sang phải, đừng chồng khít. */
    const stack = new Map();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    list.forEach((n, i) => {
      const target = safeQuery(n.selector);
      if (!target) return;
      const r = target.getBoundingClientRect();
      // Element đã ẩn (tab chưa mở, modal đã đóng) hoặc nằm ngoài màn hình thì
      // không cắm ghim — ghim lơ lửng ở mép màn hình chỉ làm người QC hiểu nhầm.
      if (!r.width && !r.height) return;
      if (r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) return;

      const shift = stack.get(target) || 0;
      stack.set(target, shift + 1);

      let el = pinEls.get(n.id);
      if (!el) {
        el = mk("button", { type: "button" });
        pinEls.set(n.id, el);
        pins.appendChild(el);
      }
      el.className = "pin " + n.kind + (editingId === n.id ? " on" : "");
      el.textContent = String(i + 1);
      el.title = "";
      el.onmouseenter = () => {
        const t = safeQuery(n.selector);
        if (!t) return;
        const text = n.note.length > 60 ? n.note.slice(0, 60) + "…" : n.note;
        drawHighlight(t, `#${i + 1} · ${AN.kindLabel(n.kind)} · ${text}`);
      };
      el.onmouseleave = () => {
        if (navEl) drawHighlight(navEl, navLabel(navEl));
        else hide(highlight, tip);
      };
      el.onclick = (e) => {
        e.stopPropagation();
        openEdit(n);
      };
      el.style.left = Math.min(Math.max(2, r.left + shift * 20), vw - 26) + "px";
      el.style.top = Math.min(Math.max(2, r.top - 22), vh - 24) + "px";
      alive.add(n.id);
    });

    for (const [id, el] of pinEls) {
      if (alive.has(id)) continue;
      el.remove();
      pinEls.delete(id);
    }
  }

  /** Công tắc ghim. Tắt ghim không đụng gì tới ghi chú, chỉ giấu đi cho đỡ rối. */
  async function applyMarkers(next, silent) {
    markersOn = next;
    renderPins();
    renderPanel();
    if (!silent) {
      await AN.setMarkers(markersOn);
      flash(
        markersOn
          ? `Hiện ghim · ${notesOfPage().length} ghi chú ở trang này`
          : "Đã ẩn ghim — Alt+Shift+M để hiện lại"
      );
    }
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
    const pinsBtn = mk("button", {
      className: "act pinsBtn",
      textContent: markersOn ? "Ẩn ghim" : "Hiện ghim",
      title: "Ẩn / hiện ghim đánh dấu chỗ đã ghi chú (Alt+Shift+M)",
    });
    pinsBtn.onclick = () => applyMarkers(!markersOn);
    const themeBtn = mk("button", { className: "act icon", title: THEME_LABEL[themePref] + " · bấm để đổi (Tự động → Sáng → Tối)" });
    themeBtn.setAttribute("aria-label", THEME_LABEL[themePref]);
    themeBtn.innerHTML = THEME_ICON[themePref];
    themeBtn.onclick = () => setThemePref(THEME_NEXT[themePref]);
    row1.append(tabs, pinsBtn, themeBtn);

    const row2 = mk("div", { className: "row" });
    const copyBtn = mk("button", { className: "act", textContent: "Copy .md" });
    const clearBtn = mk("button", { className: "act danger", textContent: "Xoá hết" });
    copyBtn.onclick = copyMarkdown;
    // [ZEN-KAIZ-DS] Bỏ window.confirm(): trình duyệt nhúng (pane của Claude, webview) tự trả false nên nút
    // không bao giờ xoá được. Thay bằng xác nhận 2 lần bấm ngay trên nút, tự huỷ sau 3 giây.
    clearBtn.onclick = async () => {
      if (!notes.length) return;
      if (!clearBtn.dataset.armed) {
        clearBtn.dataset.armed = "1";
        clearBtn.textContent = `Bấm lần nữa để xoá ${notes.length}`;
        clearBtn.classList.add("armed");
        setTimeout(() => {
          if (!clearBtn.isConnected) return;
          delete clearBtn.dataset.armed;
          clearBtn.textContent = "Xoá hết";
          clearBtn.classList.remove("armed");
        }, 3000);
        return;
      }
      notes = [];
      await AN.clearNotes(ORIGIN);
      renderFab();
      renderPanel();
      flash("Đã xoá hết");
    };
    row2.append(mk("strong", { textContent: ORIGIN.replace(/^https?:\/\//, "") }), copyBtn, clearBtn);

    head.append(row1, row2);
    panel.appendChild(head);

    const box = mk("div", { id: "list" });
    panel.appendChild(overlayScroll(box));

    if (!list.length) {
      box.appendChild(
        mk("div", { id: "empty", textContent: "Nhấn A (hoặc giữ Alt) rồi click vào element bất kỳ để ghi chú." })
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
    // [ZEN-KAIZ-DS] v2.7 — icon ZEN (icon-x-small-line · icon-pencil-line) thay ký tự "×" "✎": không dùng Unicode làm icon
    const del = mk("button", { className: "del", innerHTML: ICON_DEL, title: "Xoá ghi chú" });
    const edit = mk("button", { className: "edit", innerHTML: ICON_EDIT, title: "Sửa ghi chú" });
    del.setAttribute("aria-label", "Xoá ghi chú");
    edit.setAttribute("aria-label", "Sửa ghi chú");
    edit.onclick = (e) => {
      e.stopPropagation(); // đừng để rơi xuống item.onclick — nó cuộn trang / đổi URL
      openEdit(n);
    };
    del.onclick = async (e) => {
      // [ZEN-KAIZ-DS] chặn nổi bọt: không có dòng này thì × ở tab "Toàn site" rơi xuống item.onclick → điều hướng sang trang khác
      e.stopPropagation();
      notes = notes.filter((x) => x.id !== n.id);
      await persist();
      renderFab();
      renderPanel();
    };
    const p = mk("p");
    // Số trùng với số trên ghim, để nhìn ghim trên trang là tìm được dòng trong panel.
    const pageIdx = notesOfPage().indexOf(n);
    if (pageIdx >= 0) p.append(mk("span", { className: "num", textContent: String(pageIdx + 1) }));
    p.append(
      mk("span", { className: "kind " + n.kind, textContent: AN.kindLabel(n.kind) }),
      ...(n.ds ? [mk("span", { className: "kind ds", textContent: "Update DS", title: "AI sửa component DS gốc + ghi lý do & rule mới" })] : []),
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
    ["A", "bật / tắt chọn thẻ (khi không gõ chữ)"],
    ["Alt (giữ)", "soi element"],
    ["Alt + click", "chọn element, mở ô ghi chú"],
    ["↑ / ↓", "ra thẻ bọc ngoài / vào lại thẻ con vừa rời"],
    ["← / →", "anh em cùng cấp"],
    ["Enter · Tab", "nhảy vào ô gõ"],
    ["Alt + ↑↓←→", "đổi element cả khi đang gõ"],
    ["Cmd/Ctrl + Enter", "lưu ghi chú"],
    ["Esc", "đóng ô ghi chú / thoát soi"],
    ["Alt + Shift + A", "mở / đóng panel"],
    ["Alt + Shift + H", "tắt / bật overlay, bật là hiện ghim"],
    ["Alt + Shift + M", "ẩn / hiện ghim đã ghi chú"],
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
    if (wasEditing) {
      renderPanel();
      schedulePins();
    }
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
    schedulePins();
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

    // [ZEN-KAIZ-DS] v2.8 — "Update DS": mặc định bật với ghi chú mới. Sửa note cũ thì giữ đúng giá trị đã lưu.
    let ds = editing ? !!editing.ds : true;
    const dsRow = mk("label", { className: "dsrow", title: "Sửa tận gốc component Design System, kèm lý do + rule mới" });
    const dsInput = mk("input", { type: "checkbox", checked: ds });
    dsInput.onchange = () => (ds = dsInput.checked);
    const dsMark = mk("span", { className: "dsmark" });
    const dsBox = mk("span", { className: "dsbox" });
    dsBox.innerHTML = "<svg viewBox=\"0 0 12 12\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M2.5 6.2 4.9 8.5 9.5 3.6\"/></svg>";
    dsMark.appendChild(dsBox);
    const dsText = mk("span", { className: "dstext" });
    dsText.append(
      mk("b", { textContent: "Update DS" }),
      mk("span", { textContent: "AI sửa component gốc trong Design System (không vá tại trang), ghi lý do + rule mới." })
    );
    dsRow.append(dsInput, dsMark, dsText);

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
            ? captureNote(chosen, text, kind, ds)
            : { ...notes[i], note: text, kind, ds };
          // id và at giữ nguyên: id để panel không nhảy, at để thứ tự trong file
          // .md vẫn là thứ tự QC phát hiện, không phải thứ tự sửa lần cuối.
          next.id = notes[i].id;
          next.at = notes[i].at;
          next.editedAt = new Date().toISOString();
          notes[i] = next;
        }
      } else {
        notes.push(captureNote(chosen, text, kind, ds));
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
      if (e.key === "Escape") {
        e.preventDefault(); // v2.6: Esc mặc định = đóng dialog modal của trang
        closeInput();
      }
      e.stopPropagation();
    };

    actions.append(buildHelp(), cancel, ok);
    box.append(meta, overlayScroll(ta), kinds, dsRow, actions);
    root.appendChild(box);

    box.style.left = Math.min(x, window.innerWidth - 332) + "px";
    box.style.top = Math.min(y, window.innerHeight - 320) + "px";
  }

  // ───────────────────────────────────────────────────────────── events

  /** Alt giữ HOẶC phím A đang bật — một trong hai là soi. */
  function setPicking(on) {
    picking = on || pickLatch;
    if (!picking) {
      hide(highlight, tip);
      // Quên element đã rê: lần soi sau đứng yên trên đúng element đó vẫn phải vẽ.
      hovered = null;
    }
    pins.classList.toggle("passive", picking);
  }

  function setLatch(on) {
    pickLatch = on;
    setPicking(false); // tính lại theo latch mới
    renderFab();
    if (on && lastMouse) {
      const t = document.elementFromPoint(lastMouse.x, lastMouse.y);
      if (t && t !== host) {
        hovered = t;
        drawHighlight(t);
      }
    }
  }

  // ────────────────────────────────── phân biệt "đang gõ chữ" với "đang thao tác"

  const TEXTLESS_INPUT = /^(button|submit|reset|checkbox|radio|range|color|file|image|hidden)$/i;

  function isEditable(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.isContentEditable) return true;
    const tag = el.tagName;
    if (tag === "TEXTAREA" || tag === "SELECT") return true;
    if (tag === "INPUT") return !TEXTLESS_INPUT.test(el.type || "text");
    return el.getAttribute("role") === "textbox";
  }

  /**
   * Phím A chỉ là phím tắt khi người dùng KHÔNG gõ chữ ở đâu cả. Soi đủ mọi
   * đường chữ có thể đi vào:
   *  - bộ gõ tiếng Việt / IME đang ghép chữ (isComposing, keyCode 229)
   *  - input, textarea, select, contenteditable, role="textbox" của trang
   *  - ô gõ nằm sâu trong shadow DOM của trang (web component) — activeElement
   *    của document chỉ trả về host, phải lần xuống từng shadowRoot
   *  - trang bật designMode (trình soạn thảo kiểu cũ)
   *  - ô ghi chú của chính extension (nằm trong shadow root của host)
   */
  function isTyping(e) {
    if (e.isComposing || e.keyCode === 229) return true;
    if (document.designMode === "on") return true;
    const origin = e.composedPath ? e.composedPath()[0] : e.target;
    if (isEditable(origin)) return true;
    let a = document.activeElement;
    while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
    return isEditable(a);
  }

  function isKeyA(e) {
    // e.key trước để theo đúng bố cục bàn phím; bộ gõ trả "Process" thì mới
    // rơi về vị trí phím vật lý.
    if (e.key === "a") return true;
    return (e.key === "Process" || e.key === "Unidentified") && e.code === "KeyA";
  }

  /**
   * Phím A — capture phase để ăn trước phím tắt của trang (nhiều site gán phím
   * chữ trần cho việc riêng). Chỉ nuốt phím khi chắc chắn không phải đang gõ.
   */
  document.addEventListener(
    "keydown",
    (e) => {
      if (!enabled) return;
      // Esc thoát chọn thẻ cũng bắt ở đây: site nuốt Esc ở bubble thì vẫn thoát được.
      if (e.key === "Escape" && pickLatch) {
        e.preventDefault();
        e.stopPropagation();
        setLatch(false);
        return;
      }
      if (e.altKey || e.metaKey || e.ctrlKey || e.shiftKey || !isKeyA(e)) return;
      if (isTyping(e)) return;
      // Ô ghi chú đang mở (dù chưa focus) thì "a" là chữ đầu của note — để
      // handler nhảy-vào-ô bên dưới lo.
      if (root.querySelector("#input")) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return; // giữ phím không được bật-tắt liên hồi
      setLatch(!pickLatch);
      if (pickLatch) flash("Chọn thẻ: click vào element · A hoặc Esc để thoát");
    },
    true
  );

  /**
   * Công tắc tổng. Tắt = giấu sạch overlay và ngưng nhận thao tác — Alt + click
   * rơi xuống trang như bình thường. Ghi chú đã lưu KHÔNG bị đụng tới.
   */
  async function applyEnabled(next, silent) {
    enabled = next;
    if (!enabled) {
      pickLatch = false;
      setPicking(false);
      togglePanel(false);
      closeInput();
    }
    fab.classList.toggle("off", !enabled);
    renderFab();
    renderPins();
    if (!silent) {
      await AN.setEnabled(enabled);
      const n = notesOfPage().length;
      flash(
        enabled
          ? "Đã bật ghi chú UI" + (markersOn && n ? ` · ${n} ghim ở trang này` : "")
          : "Đã tắt — Alt+Shift+H để bật lại"
      );
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
      if (!e.altKey || !e.shiftKey) return;
      if (e.code === "KeyH") {
        e.preventDefault();
        e.stopPropagation();
        const next = !enabled;
        // Bật lại overlay = muốn nhìn lại mình đã ghi chú những đâu → hiện luôn ghim,
        // kể cả khi trước đó đã ẩn ghim.
        if (next && !markersOn) {
          markersOn = true;
          AN.setMarkers(true);
        }
        applyEnabled(next);
        return;
      }
      if (e.code === "KeyM" && enabled) {
        e.preventDefault();
        e.stopPropagation();
        applyMarkers(!markersOn);
      }
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
      // v2.6: overlay đang có thứ để đóng mà nằm trong dialog modal → Esc chỉ đóng của overlay
      if (inModal() && (root.querySelector("#input") || picking || panelOpen)) e.preventDefault();
      pickLatch = false;
      setPicking(false);
      renderFab();
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
      lastMouse = { x: e.clientX, y: e.clientY };
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
      if (!enabled || !(e.altKey || pickLatch) || e.target === host) return;
      e.preventDefault();
      e.stopPropagation();
      pickLatch = false;
      setPicking(false);
      renderFab();
      openInput(e.target, e.clientX + 12, e.clientY + 12);
    },
    true
  );

  /**
   * Đang chọn thẻ bằng phím A thì click không giữ phím gì — trang sẽ tưởng là
   * click thật. Nhiều thứ phản ứng ngay ở mousedown/pointerdown (dropdown, menu,
   * carousel kéo) nên chặn từ đó, không chỉ ở click.
   */
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"]) {
    document.addEventListener(
      type,
      (e) => {
        if (!enabled || !pickLatch || e.target === host) return;
        e.preventDefault();
        e.stopPropagation();
      },
      true
    );
  }

  // Đi lên một <section> lớn là phải cuộn tới nó — mà cuộn lại chính là lúc
  // handler này trước đây tắt highlight, đúng khoảnh khắc cần nhìn thấy nhất.
  window.addEventListener(
    "scroll",
    () => {
      schedulePins();
      if (navEl) return drawHighlight(navEl, navLabel(navEl));
      hide(highlight, tip);
    },
    true
  );

  // SPA đổi route mà không reload: content script không hook được history của
  // trang (khác world), nên soi location theo nhịp — rẻ và không bao giờ trượt.
  window.addEventListener("resize", schedulePins);
  // Lazy-load, accordion, ảnh tải xong… đẩy layout đi mà không có sự kiện nào
  // báo — soi lại vị trí ghim theo nhịp chậm.
  setInterval(() => {
    if (enabled && markersOn && notes.length) schedulePins();
  }, 1000);

  setInterval(() => {
    if (location.pathname === currentPath) return;
    currentPath = location.pathname;
    renderFab();
    renderPanel();
  }, 400);

  // Tab khác ghi thêm note vào cùng origin → đồng bộ ngay.
  UIAStore.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    const key = AN.notesKey(ORIGIN);
    if (changes[key]) {
      notes = changes[key].newValue || [];
      renderFab();
      renderPanel();
    }
    if (changes[AN.MARKERS_KEY]) {
      applyMarkers(changes[AN.MARKERS_KEY].newValue !== false, true);
    }
    if (changes[AN.THEME_KEY]) {
      themePref = changes[AN.THEME_KEY].newValue || "auto";
      applyTheme();
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
    markersOn = await AN.getMarkers();
    themePref = await AN.getTheme();
    applyTheme();
    renderFab();
    await applyEnabled(enabled, true);
    console.log(
      `%c[ui-annotate v${VERSION}]%c ` +
        (enabled
          ? "A (hoặc Alt) + click để ghi chú · ↑↓←→ đổi element · Alt+Shift+A mở panel · Alt+Shift+M ẩn/hiện ghim · Alt+Shift+H tắt overlay · "
          : "Overlay đang TẮT — Alt+Shift+H để bật lại · ") +
        `${notes.length} ghi chú đang lưu cho ${ORIGIN}`,
      "background:#f263ca;color:#fff;padding:2px 8px;border-radius:999px",
      "color:#64748b"
    );
  })();
})();

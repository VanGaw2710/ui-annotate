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
 *    Alt + click     chọn element và ghi note
 *    Cmd/Ctrl+Enter  lưu note đang gõ
 *    Esc             thoát soi / đóng panel
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

  /** @type {Array<Object>} */
  let notes = [];
  let enabled = true;
  let picking = false;
  let hovered = null;
  let panelOpen = false;
  let panelScope = "page"; // "page" | "site"
  let currentPath = location.pathname;
  let shotsEnabled = true;

  // ────────────────────────────────────────────────── element → dữ liệu

  /** Selector ngắn nhất mà vẫn trỏ đúng một element. */
  function buildSelector(el) {
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

  function outerHtmlSnippet(el) {
    const clone = el.cloneNode(false);
    let html = clone.outerHTML.replace(/\s+/g, " ");
    if (html.length > 240) html = html.slice(0, 240) + "…";
    return html;
  }

  // ─────────────────────────────────────────────── ảnh chụp element

  const SHOT_PAD = 8; // chừa viền quanh element cho Dev thấy ngữ cảnh
  const SHOT_MAX_W = 1200; // chặn ảnh quá to trên màn retina

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("không đọc được ảnh chụp"));
      img.src = src;
    });
  }

  /**
   * Chụp vùng nhìn thấy rồi crop đúng element.
   * Trả về null nếu chụp hỏng — note vẫn lưu bình thường, chỉ thiếu ảnh.
   */
  async function captureShot(el) {
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;

    // Overlay nằm trong DOM nên sẽ lọt vào ảnh — giấu đi trong lúc chụp.
    host.style.visibility = "hidden";
    let res;
    try {
      res = await chrome.runtime.sendMessage({ type: "capture" });
    } catch {
      res = null;
    } finally {
      host.style.visibility = "";
    }
    if (!res || !res.dataUrl) return null;

    let img;
    try {
      img = await loadImage(res.dataUrl);
    } catch {
      return null;
    }

    // Tự suy tỉ lệ từ ảnh thật thay vì tin devicePixelRatio — Chrome có lúc
    // trả ảnh theo tỉ lệ khác (zoom trang, màn ngoài cắm nóng).
    const scale = img.width / window.innerWidth;
    const x = Math.max(0, (rect.left - SHOT_PAD) * scale);
    const y = Math.max(0, (rect.top - SHOT_PAD) * scale);
    const w = Math.min(img.width - x, (rect.width + SHOT_PAD * 2) * scale);
    const h = Math.min(img.height - y, (rect.height + SHOT_PAD * 2) * scale);
    if (w < 4 || h < 4) return null;

    const k = Math.min(1, SHOT_MAX_W / w);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w * k);
    canvas.height = Math.round(h * k);
    canvas.getContext("2d").drawImage(img, x, y, w, h, 0, 0, canvas.width, canvas.height);

    return {
      data: canvas.toDataURL("image/webp", 0.9),
      w: canvas.width,
      h: canvas.height,
      // Element cao/rộng hơn khung nhìn thì ảnh chỉ có phần đang thấy.
      partial: rect.top < 0 || rect.left < 0 ||
        rect.bottom > window.innerHeight || rect.right > window.innerWidth,
    };
  }

  function capture(el, text, kind) {
    const rect = el.getBoundingClientRect();
    return {
      id: Date.now() + "-" + Math.random().toString(36).slice(2, 7),
      note: text,
      kind,
      tag: el.tagName.toLowerCase(),
      selector: buildSelector(el),
      classes: (el.getAttribute("class") || "").trim().slice(0, 200),
      text: (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 90),
      html: outerHtmlSnippet(el),
      styles: captureStyles(el),
      box: { w: Math.round(rect.width), h: Math.round(rect.height) },
      viewport: window.innerWidth,
      dpr: window.devicePixelRatio,
      url: location.href,
      path: location.pathname + location.search,
      title: document.title.slice(0, 120),
      at: new Date().toISOString(),
    };
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

  function saveBlob(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /** Có ảnh thì giao .zip (md + thư mục ảnh), không có thì .md trần. */
  function downloadNotes() {
    const list = panelScope === "page" ? notesOfPage() : notes;
    if (!list.length) return flash("Chưa có ghi chú nào");
    if (AN.shotCount(list)) {
      const { blob, name } = AN.buildZip(ORIGIN, list);
      saveBlob(blob, name);
      flash("Đang tải .zip kèm ảnh");
      return;
    }
    saveBlob(new Blob([AN.toMarkdown(ORIGIN, list)], { type: "text/markdown;charset=utf-8" }), AN.fileName(ORIGIN));
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
    .item .del { float: right; border: 0; background: none; cursor: pointer;
      color: #94a3b8; font-size: 15px; line-height: 1; padding: 0 2px; }
    .item .del:hover { color: #dc2626; }
    .kind { display: inline-block; font-size: 10px; padding: 1px 6px; border-radius: 999px;
      background: #e0e7ff; color: #3730a3; margin-right: 6px; vertical-align: 1px; }
    .kind.copy { background: #dcfce7; color: #166534; }
    .kind.flow { background: #fef3c7; color: #92400e; }
    .kind.bug  { background: #fee2e2; color: #991b1b; }
    #empty { padding: 22px 14px; color: #64748b; text-align: center; }
    .item .shot {
      display: block; margin-top: 8px; max-width: 100%; max-height: 90px;
      border: 1px solid #e2e8f0; border-radius: 6px; cursor: zoom-in;
      background: repeating-conic-gradient(#f8fafc 0% 25%, #eef2f7 0% 50%) 0 0 / 12px 12px;
    }
    .item .shot.big { max-height: none; cursor: zoom-out; }

    #input {
      position: fixed; pointer-events: auto; width: 320px;
      background: #fff; border: 1px solid #cbd5e1; border-radius: 10px;
      box-shadow: 0 12px 32px rgba(15,23,42,.22); padding: 12px;
    }
    #input code { display: block; font-size: 11px; color: #64748b; margin-bottom: 8px;
      word-break: break-all; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    #input textarea {
      width: 100%; height: 74px; resize: vertical; padding: 8px; color: #0f172a;
      background: #fff; border: 1px solid #cbd5e1; border-radius: 6px; font: inherit;
    }
    #input .kinds { display: flex; gap: 4px; margin-top: 8px; }
    #input .kinds button {
      border: 1px solid #e2e8f0; background: #f8fafc; color: #475569;
      border-radius: 999px; padding: 3px 10px; cursor: pointer; font-size: 11px;
    }
    #input .kinds button.on { background: #0f172a; border-color: #0f172a; color: #fff; }
    #input .actions { display: flex; gap: 6px; justify-content: flex-end; margin-top: 10px; }
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
    fab.title = `${notesOfPage().length} ghi chú ở trang này · ${notes.length} toàn site`;
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
    const dlBtn = mk("button", {
      className: "act",
      textContent: AN.shotCount(list) ? "Tải .zip" : "Tải .md",
      title: AN.shotCount(list) ? "report.md + thư mục ảnh" : "chỉ có text",
    });
    const clearBtn = mk("button", { className: "act danger", textContent: "Xoá hết" });
    copyBtn.onclick = copyMarkdown;
    dlBtn.onclick = downloadNotes;
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
    const del = mk("button", { className: "del", textContent: "×", title: "Xoá ghi chú" });
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
    item.append(del, p, c);

    if (n.shot) {
      const thumb = mk("img", { className: "shot", src: n.shot.data, alt: "" });
      thumb.onclick = (e) => {
        e.stopPropagation(); // đừng cuộn tới element, chỉ phóng to ảnh
        thumb.classList.toggle("big");
      };
      thumb.title = "Bấm để phóng to";
      item.appendChild(thumb);
    }

    // Chỉ soi được element khi note thuộc đúng trang đang mở.
    const samePage = n.path === location.pathname + location.search;
    if (samePage) {
      item.onmouseenter = () => {
        const target = safeQuery(n.selector);
        if (target) drawHighlight(target);
      };
      item.onmouseleave = () => hide(highlight, tip);
      item.onclick = (e) => {
        if (e.target === del) return;
        safeQuery(n.selector)?.scrollIntoView({ block: "center", behavior: "smooth" });
      };
    } else {
      item.onclick = (e) => {
        if (e.target === del) return;
        location.href = n.url;
      };
      item.title = "Mở " + n.url;
    }
    return item;
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

  function drawHighlight(target) {
    const r = target.getBoundingClientRect();
    Object.assign(highlight.style, {
      display: "block",
      top: r.top + "px",
      left: r.left + "px",
      width: r.width + "px",
      height: r.height + "px",
    });
    tip.textContent = `<${target.tagName.toLowerCase()}>  ${Math.round(r.width)}×${Math.round(r.height)}`;
    tip.style.display = "block";
    tip.style.top = (r.top > 26 ? r.top - 24 : r.bottom + 4) + "px";
    tip.style.left = Math.max(4, r.left) + "px";
  }

  // ─────────────────────────────────────────────────────── ô nhập note

  let lastKind = "ui";

  function openInput(target, x, y, shotPromise) {
    root.querySelector("#input")?.remove();
    const box = mk("div", { id: "input" });
    const meta = mk("code", { textContent: buildSelector(target) });
    const ta = mk("textarea", { placeholder: "Cần điều chỉnh gì ở đây?" });

    let kind = lastKind;
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
    const ok = mk("button", { className: "primary", textContent: "Lưu ghi chú" });

    const commit = async () => {
      const text = ta.value.trim();
      if (!text) return box.remove();
      lastKind = kind;
      const note = capture(target, text, kind);
      box.remove();
      // Ảnh đã chụp xong từ lúc click, ở đây chỉ chờ nốt nếu còn dở.
      const shot = shotPromise ? await shotPromise : null;
      if (shot) note.shot = shot;
      notes.push(note);
      await persist();
      renderFab();
      renderPanel();
      flash(`Đã lưu${shot ? " kèm ảnh" : ""} · ${notes.length} ghi chú`);
    };

    ok.onclick = commit;
    cancel.onclick = () => box.remove();
    ta.onkeydown = (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) commit();
      if (e.key === "Escape") box.remove();
      e.stopPropagation();
    };

    actions.append(cancel, ok);
    box.append(meta, ta, kinds, actions);
    root.appendChild(box);

    box.style.left = Math.min(x, window.innerWidth - 332) + "px";
    box.style.top = Math.min(y, window.innerHeight - 230) + "px";
    ta.focus();
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
      root.querySelector("#input")?.remove();
      hide(highlight, tip);
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
    if (e.key === "Alt") setPicking(true);
    if (e.key === "Escape") {
      setPicking(false);
      togglePanel(false);
      root.querySelector("#input")?.remove();
    }
  });

  document.addEventListener("keyup", (e) => {
    if (enabled && e.key === "Alt") setPicking(false);
  });

  window.addEventListener("blur", () => setPicking(false));

  document.addEventListener(
    "mousemove",
    (e) => {
      if (!enabled || !picking) return;
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
      // Chụp ngay lúc click, trước khi trang kịp đổi (hover state, dropdown…).
      // Overlay bị giấu trong lúc chụp nên ô nhập note không lọt vào ảnh.
      const shotPromise = shotsEnabled
        ? captureShot(e.target).catch(() => null)
        : Promise.resolve(null);
      openInput(e.target, e.clientX + 12, e.clientY + 12, shotPromise);
    },
    true
  );

  window.addEventListener("scroll", () => hide(highlight, tip), true);

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
    if (changes[AN.SHOTS_KEY]) {
      shotsEnabled = changes[AN.SHOTS_KEY].newValue !== false;
    }
  });

  // ──────────────────────────────────────────────────────────── khởi động

  (async () => {
    notes = await AN.getNotes(ORIGIN);
    enabled = await AN.getEnabled();
    shotsEnabled = await AN.getShots();
    renderFab();
    await applyEnabled(enabled, true);
    console.log(
      "%c[ui-annotate]%c " +
        (enabled
          ? "Alt + click để ghi chú · Alt+Shift+A mở panel · Alt+Shift+H tắt overlay · "
          : "Overlay đang TẮT — Alt+Shift+H để bật lại · ") +
        `${notes.length} ghi chú đang lưu cho ${ORIGIN}`,
      "background:#2563eb;color:#fff;padding:2px 6px;border-radius:3px",
      "color:#64748b"
    );
  })();
})();

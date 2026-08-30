/**
 * react-probe.js — chạy ở world "MAIN", tức là cùng thế giới JS với trang web.
 *
 * Lý do phải tách ra một file riêng: content.js chạy ở isolated world nên nó
 * thấy DOM thật nhưng KHÔNG thấy được thuộc tính `__reactFiber$xxx` mà React
 * gắn lên node — thuộc tính đó là expando của trang, isolated world bị chặn.
 * File này chạy trong trang nên đọc được, rồi bắc cầu kết quả về bằng
 * window.postMessage.
 *
 * Giao thức (cả hai chiều đều đi qua window.postMessage, cùng origin):
 *   ← { source: "ui-annotate", type: "react-probe", id }
 *        content.js đã gắn sẵn [data-ui-annotate-probe] lên element cần soi.
 *   → { source: "ui-annotate-probe", type: "react-result", id, info }
 *        info = null nếu trang không dùng React hoặc không tìm ra tên nào.
 *
 * Không đụng gì vào trang: chỉ đọc, không patch, không giữ tham chiếu.
 */
(() => {
  "use strict";

  if (window.__uiAnnotateProbeLoaded) return;
  window.__uiAnnotateProbeLoaded = true;

  const MARK = "data-ui-annotate-probe";

  /** Node do React dựng ra sẽ có một key dạng __reactFiber$<hash ngẫu nhiên>. */
  function fiberOf(node) {
    for (const key in node) {
      if (key.startsWith("__reactFiber$")) return node[key];
      // React 16 / 17 cũ.
      if (key.startsWith("__reactInternalInstance$")) return node[key];
    }
    return null;
  }

  /**
   * Lấy tên hiển thị của một fiber. `type` là string ("div", "span") với thẻ
   * HTML thường — bỏ qua, vì mình đã có tag rồi. Component thật thì `type` là
   * function/class, hoặc object bọc của memo() / forwardRef().
   */
  function nameOf(fiber) {
    const t = fiber.type || fiber.elementType;
    if (!t || typeof t === "string") return null;
    if (typeof t === "function") return t.displayName || t.name || null;
    if (typeof t === "object") {
      // memo(Foo) → { type: Foo }, forwardRef(fn) → { render: fn }
      return (
        t.displayName ||
        (t.type && (t.type.displayName || t.type.name)) ||
        (t.render && (t.render.displayName || t.render.name)) ||
        null
      );
    }
    return null;
  }

  /**
   * Tên do bundler sinh ra, in vào file .md chỉ tổ nhiễu. Đo trên react.dev
   * (production build) thì chuỗi tổ tiên ra đúng thế này: `a` `d` `K` `tR` `p`
   * `z` `$` — tên đã bị minify. In `<K>` cho Dev thì tệ hơn là không in gì.
   */
  const JUNK = /^(Unknown$|Anonymous$|Object$|.{1,2}$|_|\$)/;
  /** Wrapper của thư viện UI (radix, headlessui): có ở mọi element, không định vị được gì. */
  const LIB_NOISE = /^(Primitive\.|Slot$|SlotClone$|.*(Provider|Consumer|Context|Portal|Presence)$)/;
  /** Wrapper hạ tầng — có mặt ở mọi element nên không phân biệt được gì. */
  const WRAPPER = new Set([
    "Fragment", "StrictMode", "Suspense", "SuspenseList", "Profiler",
    "Provider", "Consumer", "Context.Provider", "Context.Consumer",
    "ErrorBoundary", "Router", "RouterProvider", "Route", "Routes", "Outlet",
    "InnerLayoutRouter", "OuterLayoutRouter", "LayoutRouter", "RenderFromTemplateContext",
    "ScrollAndFocusHandler", "RedirectBoundary", "NotFoundBoundary", "LoadingBoundary",
    "AppRouter", "HotReload", "DevRootNotFoundBoundary", "ClientPageRoot", "ClientSegmentRoot",
    "Head", "HeadManagerContext", "AppContainer", "PathnameContextProviderAdapter",
  ]);

  function usable(name) {
    return !!name && !JUNK.test(name) && !WRAPPER.has(name) && !LIB_NOISE.test(name);
  }

  /**
   * React dev build gắn `_debugSource = { fileName, lineNumber }` — đúng file
   * và đúng dòng của component trong source. Đây là thứ đáng giá nhất cả file
   * này. Production build và React 19 không còn nó, khi đó chịu, chỉ có tên.
   */
  function sourceOf(fiber) {
    const s = fiber._debugSource || (fiber._debugOwner && fiber._debugOwner._debugSource);
    if (!s || !s.fileName) return "";
    // Đường dẫn tuyệt đối của máy build không giúp gì cho việc grep; cắt về
    // dạng tương đối kể từ thư mục nguồn quen thuộc.
    const rel = String(s.fileName).replace(/^.*?\/((?:src|app|pages|components|lib)\/)/, "$1");
    return s.lineNumber ? `${rel}:${s.lineNumber}` : rel;
  }

  /**
   * Đi ngược lên cây fiber, gom tối đa 3 tên dùng được. Cái đầu tiên là
   * component gần element nhất — thứ cần sửa; hai cái sau là ngữ cảnh để biết
   * nó nằm ở màn hình nào (Button có mặt khắp nơi, Button trong CheckoutForm
   * thì chỉ một chỗ).
   */
  function probe(node) {
    let fiber = fiberOf(node);
    if (!fiber) return null;

    const chain = [];
    let file = "";
    let hops = 0;
    while (fiber && hops++ < 40 && chain.length < 3) {
      const name = nameOf(fiber);
      if (usable(name) && name !== chain[chain.length - 1]) {
        chain.push(name);
        if (!file) file = sourceOf(fiber);
      }
      fiber = fiber.return;
    }
    // Có fiber mà không moi ra được tên nào dùng được = build production đã
    // minify. Trả về cờ thay vì null để overlay nói thẳng lý do — im lặng thì
    // người QC tưởng tính năng hỏng và đi báo bug.
    if (!chain.length) return { chain: [], minified: true };
    return { chain, file };
  }

  window.addEventListener("message", (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.source !== "ui-annotate" || d.type !== "react-probe") return;

    let info = null;
    try {
      const node = document.querySelector("[" + MARK + "]");
      if (node) info = probe(node);
    } catch (_) {
      // Trang có Proxy lạ trên DOM node là đọc fiber ném lỗi. Im lặng trả null:
      // đây là tính năng phụ, không được phép làm hỏng luồng ghi chú.
    }

    window.postMessage(
      { source: "ui-annotate-probe", type: "react-result", id: d.id, info },
      location.origin === "null" ? "*" : location.origin
    );
  });
})();

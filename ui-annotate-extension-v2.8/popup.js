/**
 * popup.js — bảng điều khiển khi bấm icon extension (v2.8).
 *
 * Làm được cả khi trang hiện tại không chạy content script (vd. vừa cài xong
 * chưa F5): mọi thao tác đọc/ghi đều đi thẳng UIAStore (chrome.storage).
 * v2.7: bỏ "Tải .md", "Xoá hết" xác nhận bằng 2 lần bấm (không dùng confirm()), thêm chọn Giao diện.
 */
(async () => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let origin = null;
  try {
    const u = new URL(tab.url);
    if (/^https?:$/.test(u.protocol)) origin = u.origin;
  } catch {
    /* chrome://, file:// … — không gắn được */
  }

  let notes = [];

  function flash(msg) {
    const f = $("flash");
    f.textContent = msg;
    f.style.display = "block";
    setTimeout(() => (f.style.display = "none"), 2200);
  }

  // ── Giao diện: popup không có trang để "theo", nên Tự động = theo hệ điều hành
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  let themePref = "auto";
  function applyTheme() {
    const t = themePref === "auto" ? (mq.matches ? "dark" : "light") : themePref;
    document.documentElement.setAttribute("data-uia-theme", t);
    for (const b of $("theme").querySelectorAll("button")) b.classList.toggle("on", b.dataset.v === themePref);
  }
  mq.addEventListener("change", applyTheme);
  $("theme").onclick = async (e) => {
    const v = e.target.closest("button")?.dataset.v;
    if (!v) return;
    themePref = v;
    applyTheme();
    await AN.setTheme(v);
  };

  function render() {
    $("origin").textContent = origin || "Trang này không dùng được (chrome:// hoặc file://)";
    $("total").textContent = String(notes.length);

    const pages = AN.groupByPath(notes).size;
    $("detail").textContent = notes.length ? `ghi chú trên ${pages} trang` : "ghi chú — chưa có gì";

    const empty = !notes.length;
    $("copy").disabled = empty;
    $("clear").disabled = empty;
  }

  async function renderOthers() {
    const all = await AN.listOrigins();
    const others = all.filter((o) => o.origin !== origin);
    if (!others.length) return;
    $("others").hidden = false;
    const box = $("othersList");
    box.textContent = "";
    for (const o of others.slice(0, 8)) {
      const a = document.createElement("a");
      a.append(
        Object.assign(document.createElement("span"), { textContent: o.origin.replace(/^https?:\/\//, "") }),
        Object.assign(document.createElement("em"), { textContent: o.count + " ghi chú" })
      );
      a.title = "Copy .md của site này";
      a.onclick = async () => {
        const list = await AN.getNotes(o.origin);
        await navigator.clipboard.writeText(AN.toMarkdown(o.origin, list));
        flash(`Đã copy ${list.length} ghi chú của ${o.origin}`);
      };
      box.appendChild(a);
    }
  }

  $("copy").onclick = async () => {
    await navigator.clipboard.writeText(AN.toMarkdown(origin, notes));
    flash(`Đã copy ${notes.length} ghi chú — dán thẳng cho Claude Code`);
  };

  // Xác nhận 2 lần bấm ngay trên nút (confirm() bị chặn ở nhiều môi trường), tự huỷ sau 3 giây
  const clearBtn = $("clear");
  let armTimer = 0;
  clearBtn.onclick = async () => {
    if (!clearBtn.dataset.armed) {
      clearBtn.dataset.armed = "1";
      clearBtn.textContent = `Bấm lần nữa · xoá ${notes.length}`;
      clearBtn.style.cssText = "background: var(--neg-text); border-color: var(--neg-text); color: #fff";
      armTimer = setTimeout(() => {
        delete clearBtn.dataset.armed;
        clearBtn.textContent = "Xoá hết";
        clearBtn.style.cssText = "";
      }, 3000);
      return;
    }
    clearTimeout(armTimer);
    delete clearBtn.dataset.armed;
    clearBtn.textContent = "Xoá hết";
    clearBtn.style.cssText = "";
    await AN.clearNotes(origin);
    notes = [];
    render();
    flash("Đã xoá hết");
  };

  const enabledBox = $("enabled");
  enabledBox.onchange = () => AN.setEnabled(enabledBox.checked);

  themePref = await AN.getTheme();
  applyTheme();
  enabledBox.checked = await AN.getEnabled();
  if (origin) notes = await AN.getNotes(origin);
  render();
  await renderOthers();
})();

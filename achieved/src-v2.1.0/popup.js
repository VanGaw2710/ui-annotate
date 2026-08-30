/**
 * popup.js — bảng điều khiển khi bấm icon extension.
 *
 * Làm được cả khi trang hiện tại không chạy content script (vd. vừa cài xong
 * chưa F5): mọi thao tác đọc/ghi đều đi thẳng chrome.storage.
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

  function render() {
    $("origin").textContent = origin || "Trang này không dùng được (chrome:// hoặc file://)";
    $("total").textContent = String(notes.length);

    const pages = AN.groupByPath(notes).size;
    $("detail").textContent = notes.length
      ? `ghi chú trên ${pages} trang`
      : "ghi chú — chưa có gì";
    if (notes.length && origin) {
      AN.usageText(origin).then((u) => {
        if (u) $("detail").textContent = `ghi chú trên ${pages} trang · ${u}`;
      });
    }

    const shots = AN.shotCount(notes);
    $("download").textContent = shots ? "Tải .zip" : "Tải .md";
    const hint = $("shotHint");
    hint.hidden = !shots;
    if (shots) {
      hint.textContent = `Gói .zip gồm report.md + ${shots} ảnh chụp trong thư mục anh/.`;
    }

    const empty = !notes.length;
    $("copy").disabled = empty;
    $("download").disabled = empty;
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
        Object.assign(document.createElement("span"), {
          textContent: o.origin.replace(/^https?:\/\//, ""),
        }),
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
    flash(`Đã copy ${notes.length} ghi chú — dán thẳng cho Dev`);
  };

  $("download").onclick = () => {
    const hasShots = AN.shotCount(notes) > 0;
    const { blob, name } = hasShots
      ? AN.buildZip(origin, notes)
      : {
          blob: new Blob([AN.toMarkdown(origin, notes)], { type: "text/markdown;charset=utf-8" }),
          name: AN.fileName(origin),
        };
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    flash("Đang tải " + name);
  };

  $("clear").onclick = async () => {
    if (!confirm(`Xoá toàn bộ ${notes.length} ghi chú của ${origin}?`)) return;
    await AN.clearNotes(origin);
    notes = [];
    render();
    flash("Đã xoá hết");
  };

  const enabledBox = $("enabled");
  enabledBox.onchange = () => AN.setEnabled(enabledBox.checked);

  const shotsBox = $("shots");
  shotsBox.onchange = () => {
    AN.setShots(shotsBox.checked);
    flash(shotsBox.checked ? "Sẽ chụp ảnh cho ghi chú mới" : "Ghi chú mới sẽ không kèm ảnh");
  };

  enabledBox.checked = await AN.getEnabled();
  shotsBox.checked = await AN.getShots();
  if (origin) notes = await AN.getNotes(origin);
  render();
  await renderOthers();
})();

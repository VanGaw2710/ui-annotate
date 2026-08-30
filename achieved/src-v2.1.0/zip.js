/**
 * zip.js — bộ đóng gói ZIP tối giản, thuần JS, không thư viện ngoài.
 *
 * Dùng method "store" (không nén): nội dung chính là ảnh WebP đã nén sẵn, nén
 * thêm chỉ tốn thời gian mà gần như không giảm dung lượng. Markdown chịu thiệt
 * vài KB — đổi lại không phải nhúng thư viện deflate vào extension.
 */
(() => {
  "use strict";

  const TABLE = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[i] = c >>> 0;
    }
    return t;
  })();

  function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  /** Giờ kiểu MS-DOS mà format ZIP yêu cầu. */
  function dosTime(d = new Date()) {
    return {
      time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
      date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    };
  }

  const utf8 = (s) => new TextEncoder().encode(s);

  /** dataURL (base64) → Uint8Array. */
  function fromDataUrl(dataUrl) {
    const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  /**
   * @param {Array<{name: string, data: Uint8Array|string}>} files
   * @returns {Blob}
   */
  function zip(files) {
    const { time, date } = dosTime();
    const chunks = [];
    const central = [];
    let offset = 0;

    for (const f of files) {
      const name = utf8(f.name);
      const data = typeof f.data === "string" ? utf8(f.data) : f.data;
      const crc = crc32(data);

      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true); // chữ ký local file header
      local.setUint16(4, 20, true); // version cần để giải nén
      local.setUint16(6, 0x0800, true); // cờ: tên file mã hoá UTF-8
      local.setUint16(8, 0, true); // method 0 = store
      local.setUint16(10, time, true);
      local.setUint16(12, date, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, data.length, true);
      local.setUint32(22, data.length, true);
      local.setUint16(26, name.length, true);
      local.setUint16(28, 0, true);
      chunks.push(new Uint8Array(local.buffer), name, data);

      const dir = new DataView(new ArrayBuffer(46));
      dir.setUint32(0, 0x02014b50, true); // chữ ký central directory
      dir.setUint16(4, 20, true);
      dir.setUint16(6, 20, true);
      dir.setUint16(8, 0x0800, true);
      dir.setUint16(10, 0, true);
      dir.setUint16(12, time, true);
      dir.setUint16(14, date, true);
      dir.setUint32(16, crc, true);
      dir.setUint32(20, data.length, true);
      dir.setUint32(24, data.length, true);
      dir.setUint16(28, name.length, true);
      dir.setUint32(42, offset, true);
      central.push(new Uint8Array(dir.buffer), name);

      offset += 30 + name.length + data.length;
    }

    const centralSize = central.reduce((n, c) => n + c.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); // chữ ký end of central directory
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);

    return new Blob([...chunks, ...central, new Uint8Array(end.buffer)], {
      type: "application/zip",
    });
  }

  window.ANZip = { zip, fromDataUrl, crc32 };
})();

/**
 * store-chrome.js — UIAStore cho bản Chrome extension: bọc chrome.storage.local.
 *
 * Engine (shared.js · content.js) dùng chung với bản nhúng trong ZEN-KAIZ-DS và chỉ biết window.UIAStore.
 * Bản nhúng: public/ui-annotate/store.js (localStorage, 1 origin). Bản extension: file này
 * (chrome.storage, mọi site, đồng bộ giữa các tab qua chrome.storage.onChanged).
 */
(() => {
  "use strict";
  if (window.UIAStore) return;
  window.UIAStore = {
    VERSION: chrome.runtime.getManifest().version,
    local: {
      get: (keys) => chrome.storage.local.get(keys),
      set: (items) => chrome.storage.local.set(items),
      remove: (keys) => chrome.storage.local.remove(keys),
    },
    onChanged: { addListener: (fn) => chrome.storage.onChanged.addListener(fn) },
  };
})();

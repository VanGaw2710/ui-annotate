/**
 * background.js — service worker, chỉ làm một việc: hiện số ghi chú của site
 * đang mở lên badge của icon extension.
 *
 * Không dùng chung shared.js vì file đó treo API vào window — service worker
 * không có window. Logic ở đây đủ nhỏ để lặp lại.
 */
"use strict";

const NOTES_PREFIX = "notes::";

async function countFor(url) {
  let origin;
  try {
    origin = new URL(url).origin;
  } catch {
    return null;
  }
  if (!/^https?:$/.test(new URL(url).protocol)) return null;
  const key = NOTES_PREFIX + origin;
  const bag = await chrome.storage.local.get(key);
  return Array.isArray(bag[key]) ? bag[key].length : 0;
}

async function paintBadge(tabId, url) {
  const n = await countFor(url || "");
  await chrome.action.setBadgeBackgroundColor({ color: "#2563eb" });
  await chrome.action.setBadgeText({
    tabId,
    text: n ? String(n) : "",
  });
}

/**
 * Chụp vùng nhìn thấy của tab. `captureVisibleTab` chỉ gọi được từ context của
 * extension, content script phải nhờ qua đây. Content script tự crop lại đúng
 * vùng element sau khi nhận ảnh.
 */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== "capture") return;
  const windowId = sender.tab?.windowId;
  chrome.tabs.captureVisibleTab(windowId, { format: "png" }, (dataUrl) => {
    if (chrome.runtime.lastError) {
      sendResponse({ error: chrome.runtime.lastError.message });
      return;
    }
    sendResponse({ dataUrl });
  });
  return true; // giữ kênh mở cho sendResponse bất đồng bộ
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (tab) paintBadge(tabId, tab.url);
});

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === "complete" || info.url) paintBadge(tabId, tab.url);
});

// Ghi chú mới ở tab nào đó → cập nhật badge cho mọi tab cùng origin.
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "local") return;
  const touched = Object.keys(changes).filter((k) => k.startsWith(NOTES_PREFIX));
  if (!touched.length) return;
  const origins = new Set(touched.map((k) => k.slice(NOTES_PREFIX.length)));
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    try {
      if (origins.has(new URL(tab.url).origin)) paintBadge(tab.id, tab.url);
    } catch {
      /* tab nội bộ của Chrome, không có URL hợp lệ */
    }
  }
});

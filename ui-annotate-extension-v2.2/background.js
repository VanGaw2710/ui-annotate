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

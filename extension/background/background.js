/**
 * CloakLLM Extension Background Service Worker (Manifest V3)
 * Monitors proxy connection health and coordinates badge counters.
 */

const DEFAULT_PROXY_URL = 'http://127.0.0.1:8080';

// Check connection to CloakLLM Proxy
async function checkProxyHealth() {
  try {
    const res = await fetch(`${DEFAULT_PROXY_URL}/health`, { method: 'GET' });
    if (res.ok) {
      chrome.action.setBadgeText({ text: 'ON' });
      chrome.action.setBadgeBackgroundColor({ color: '#10b981' }); // emerald
      return true;
    }
  } catch {
    chrome.action.setBadgeText({ text: 'OFF' });
    chrome.action.setBadgeBackgroundColor({ color: '#71717a' }); // zinc
  }
  return false;
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    shieldEnabled: true,
    proxyUrl: DEFAULT_PROXY_URL,
    totalSanitizedCount: 0,
  });
  checkProxyHealth();
});

// Periodic health poll every 30 seconds
chrome.alarms?.create('healthCheck', { periodInMinutes: 0.5 });
chrome.alarms?.onAlarm.addListener((alarm) => {
  if (alarm.name === 'healthCheck') {
    checkProxyHealth();
  }
});

// Listen for messages from content script or popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'CHECK_HEALTH') {
    checkProxyHealth().then((isOnline) => sendResponse({ isOnline }));
    return true;
  }

  if (message.type === 'INCREMENT_COUNT') {
    chrome.storage.local.get(['totalSanitizedCount'], (data) => {
      const current = (data.totalSanitizedCount || 0) + (message.count || 1);
      chrome.storage.local.set({ totalSanitizedCount: current });
      sendResponse({ totalSanitizedCount: current });
    });
    return true;
  }
});

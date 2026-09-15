/**
 * CloakLLM Shield - Popup Controller
 */

const DEFAULT_PROXY_URL = 'http://127.0.0.1:8080';

const storage = {
  get: (keys, cb) => {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(keys, cb);
    } else {
      const res = {};
      for (const k of keys) {
        const val = localStorage.getItem(`cloakllm_${k}`);
        res[k] = val !== null ? JSON.parse(val) : undefined;
      }
      cb(res);
    }
  },
  set: (obj, cb) => {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set(obj, cb);
    } else {
      for (const [k, v] of Object.entries(obj)) {
        localStorage.setItem(`cloakllm_${k}`, JSON.stringify(v));
      }
      if (cb) cb();
    }
  },
};

document.addEventListener('DOMContentLoaded', async () => {
  const statusBadge = document.getElementById('statusBadge');
  const statusText = document.getElementById('statusText');
  const shieldToggle = document.getElementById('shieldToggle');
  const entitiesCount = document.getElementById('entitiesCount');
  const testInput = document.getElementById('testInput');
  const testBtn = document.getElementById('testBtn');
  const testOutput = document.getElementById('testOutput');

  let proxyUrl = DEFAULT_PROXY_URL;

  // 1. Load settings
  storage.get(['shieldEnabled', 'proxyUrl', 'totalSanitizedCount'], (data) => {
    if (data.shieldEnabled !== undefined) {
      shieldToggle.checked = Boolean(data.shieldEnabled);
    }
    if (data.proxyUrl) {
      proxyUrl = data.proxyUrl;
    }
    if (data.totalSanitizedCount) {
      entitiesCount.textContent = data.totalSanitizedCount;
    }
  });

  // 2. Healthcheck
  try {
    const res = await fetch(`${proxyUrl}/health`);
    if (res.ok) {
      statusBadge.className = 'status-pill online';
      statusText.textContent = 'Online';

      // Fetch live stats
      try {
        const statsRes = await fetch(`${proxyUrl}/api/stats`);
        if (statsRes.ok) {
          const stats = await statsRes.json();
          entitiesCount.textContent = stats.totalEntitiesBlocked || '0';
        }
      } catch {
        // use stored count
      }
    } else {
      throw new Error('Non-200 response');
    }
  } catch {
    statusBadge.className = 'status-pill offline';
    statusText.textContent = 'Offline';
  }

  // 3. Toggle change
  shieldToggle.addEventListener('change', () => {
    storage.set({ shieldEnabled: shieldToggle.checked });
  });

  // 4. Test button
  testBtn.addEventListener('click', async () => {
    const text = testInput.value.trim();
    if (!text) return;

    testBtn.disabled = true;
    testBtn.textContent = 'Sanitizing...';
    testOutput.style.display = 'none';

    try {
      const res = await fetch(`${proxyUrl}/api/sanitize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });

      if (res.ok) {
        const data = await res.json();
        testOutput.style.display = 'block';
        testOutput.textContent = `🛡️ Masked Output:\n${data.sanitized}\n\nDetected (${data.entities.length}):\n${data.entities.map(e => `• [${e.type}]: ${e.value}`).join('\n') || 'None'}`;
      } else {
        testOutput.style.display = 'block';
        testOutput.textContent = `⚠️ Error: Proxy returned HTTP ${res.status}`;
      }
    } catch (err) {
      testOutput.style.display = 'block';
      testOutput.textContent = `❌ Proxy offline at ${proxyUrl}. Start with 'npm start'.`;
    } finally {
      testBtn.disabled = false;
      testBtn.textContent = 'Sanitize & Inspect';
    }
  });
});

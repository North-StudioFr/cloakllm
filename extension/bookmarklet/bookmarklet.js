/**
 * CloakLLM Instant Zero-Install Bookmarklet
 * Drag to bookmarks bar or run in developer console on chatgpt.com / claude.ai / LibreChat.
 * Connects directly to local CloakLLM proxy at http://127.0.0.1:8080.
 */

(function () {
  const PROXY_URL = 'http://127.0.0.1:8080';

  // Check if already injected
  if (window.__cloakllm_injected) {
    alert('🛡️ CloakLLM Shield is already active on this page!');
    return;
  }
  window.__cloakllm_injected = true;

  function showToast(msg) {
    const el = document.createElement('div');
    el.style.position = 'fixed';
    el.style.bottom = '20px';
    el.style.right = '20px';
    el.style.background = '#09090b';
    el.style.color = '#10b981';
    el.style.border = '1px solid #10b981';
    el.style.borderRadius = '6px';
    el.style.padding = '10px 16px';
    el.style.fontSize = '12px';
    el.style.fontFamily = 'monospace';
    el.style.zIndex = '9999999';
    el.style.boxShadow = '0 4px 12px rgba(0,0,0,0.5)';
    el.textContent = `🛡️ CloakLLM: ${msg}`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 4000);
  }

  async function sanitizeText(text) {
    try {
      const res = await fetch(`${PROXY_URL}/api/sanitize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (res.ok) return await res.json();
    } catch {
      // offline
    }
    return null;
  }

  document.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      const activeEl = document.activeElement;
      if (!activeEl) return;

      const text = activeEl.value || activeEl.innerText || '';
      if (!text || text.trim().length === 0) return;

      e.preventDefault();
      e.stopPropagation();

      const result = await sanitizeText(text);
      if (result && result.entities && result.entities.length > 0) {
        if (activeEl.value !== undefined) {
          activeEl.value = result.sanitized;
          activeEl.dispatchEvent(new Event('input', { bubbles: true }));
          activeEl.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          activeEl.innerText = result.sanitized;
          activeEl.dispatchEvent(new Event('input', { bubbles: true }));
        }
        showToast(`Sanitized ${result.entities.length} sensitive items (${result.entities.map(x => x.type).join(', ')})`);
      }

      setTimeout(() => {
        const sendBtn =
          document.querySelector('button[data-testid="send-button"]') ||
          document.querySelector('button[aria-label*="Send" i]') ||
          document.querySelector('form button[type="submit"]');
        if (sendBtn && !sendBtn.disabled) {
          sendBtn.click();
        }
      }, 50);
    }
  }, true);

  showToast('Sovereign Privacy Shield Attached! Type your prompt safely.');
})();

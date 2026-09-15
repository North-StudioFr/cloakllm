/**
 * CloakLLM Content Script
 * Intercepts and pseudonymizes sensitive prompts on ChatGPT, Claude, and LibreChat/Open WebUI.
 */

(function () {
  let isShieldEnabled = true;
  let proxyUrl = 'http://127.0.0.1:8080';
  let isSanitizing = false;

  // Load configuration from extension storage
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(['shieldEnabled', 'proxyUrl'], (data) => {
      if (data.shieldEnabled !== undefined) isShieldEnabled = Boolean(data.shieldEnabled);
      if (data.proxyUrl) proxyUrl = data.proxyUrl;
      updateBadgeUI();
    });

    chrome.storage.onChanged?.addListener((changes) => {
      if (changes.shieldEnabled) {
        isShieldEnabled = Boolean(changes.shieldEnabled.newValue);
        updateBadgeUI();
      }
      if (changes.proxyUrl) {
        proxyUrl = changes.proxyUrl.newValue;
      }
    });
  }

  // Toast notification helper
  function showToast(title, body, isWarning = false) {
    const existing = document.querySelector('.cloakllm-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `cloakllm-toast ${isWarning ? 'warning' : ''}`;
    toast.innerHTML = `
      <div class="cloakllm-toast-title">
        <span>${isWarning ? '⚠️' : '🛡️'}</span>
        <span>${title}</span>
      </div>
      <div class="cloakllm-toast-body">${body}</div>
    `;

    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  // Find the active prompt input element
  function findPromptInput() {
    // 1. ChatGPT
    const chatgptTextarea = document.querySelector('#prompt-textarea');
    if (chatgptTextarea) return chatgptTextarea;

    // 2. Claude
    const claudeEditor = document.querySelector('div.ProseMirror[contenteditable="true"]');
    if (claudeEditor) return claudeEditor;

    // 3. LibreChat / Open WebUI / Generic
    const genericTextareas = document.querySelectorAll('textarea');
    for (const ta of genericTextareas) {
      const ph = (ta.getAttribute('placeholder') || '').toLowerCase();
      if (ph.includes('message') || ph.includes('ask') || ph.includes('chat') || ph.includes('envoyer')) {
        return ta;
      }
    }

    // Fallback: any visible contenteditable
    const editables = document.querySelectorAll('[contenteditable="true"]');
    for (const ed of editables) {
      if (ed.offsetParent !== null) return ed;
    }

    return genericTextareas[0] || null;
  }

  // Read text content from input or contenteditable
  function getInputValue(el) {
    if (!el) return '';
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      return el.value || '';
    }
    return el.innerText || el.textContent || '';
  }

  // Safely update input element value with React and ProseMirror state synchronization
  function setInputValue(el, text) {
    if (!el) return;
    if (el.tagName === 'TEXTAREA') {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
      if (setter) {
        setter.call(el, text);
      } else {
        el.value = text;
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (el.tagName === 'INPUT') {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      if (setter) {
        setter.call(el, text);
      } else {
        el.value = text;
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      // Contenteditable (Claude, modern ChatGPT)
      try {
        el.focus();
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(el);
        selection.removeAllRanges();
        selection.addRange(range);
        if (document.execCommand && document.execCommand('insertText', false, text)) {
          // Success with execCommand
        } else {
          el.innerText = text;
        }
      } catch {
        el.innerText = text;
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  // Send text to CloakLLM local proxy to sanitize
  async function sanitizeText(text) {
    try {
      const res = await fetch(`${proxyUrl}/api/sanitize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (res.ok) {
        return await res.json();
      }
    } catch {
      // Proxy offline
    }
    return null;
  }

  // Badge injection
  function ensureBadge() {
    if (document.getElementById('cloakllm-badge')) return;

    const inputEl = findPromptInput();
    if (!inputEl) return;

    const badge = document.createElement('div');
    badge.id = 'cloakllm-badge';
    badge.className = `cloakllm-badge ${isShieldEnabled ? 'active' : 'inactive'}`;
    badge.title = 'Click to toggle CloakLLM sovereign privacy shield';
    badge.innerHTML = `
      <span class="cloakllm-dot"></span>
      <span>Shield: <strong>${isShieldEnabled ? 'ON' : 'OFF'}</strong></span>
    `;

    badge.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      isShieldEnabled = !isShieldEnabled;
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ shieldEnabled: isShieldEnabled });
      }
      updateBadgeUI();
      showToast(
        isShieldEnabled ? 'Privacy Shield Activated' : 'Privacy Shield Paused',
        isShieldEnabled
          ? 'Prompts will be pseudonymized before cloud transmission.'
          : 'Prompts will be sent directly without local filtering.'
      );
    });

    // Place badge near the input
    const parentContainer = inputEl.closest('form') || inputEl.parentElement;
    if (parentContainer) {
      badge.style.position = 'relative';
      badge.style.margin = '4px 0';
      badge.style.display = 'inline-flex';
      parentContainer.insertBefore(badge, parentContainer.firstChild);
    }
  }

  function updateBadgeUI() {
    const badge = document.getElementById('cloakllm-badge');
    if (!badge) return;
    badge.className = `cloakllm-badge ${isShieldEnabled ? 'active' : 'inactive'}`;
    badge.innerHTML = `
      <span class="cloakllm-dot"></span>
      <span>Shield: <strong>${isShieldEnabled ? 'ON' : 'OFF'}</strong></span>
    `;
  }

  // Helper to find send button
  function findSendButton() {
    return (
      document.querySelector('button[data-testid="send-button"]') ||
      document.querySelector('button[aria-label*="Send" i]') ||
      document.querySelector('button[aria-label*="Envoyer" i]') ||
      document.querySelector('form button[type="submit"]')
    );
  }

  // Common prompt processor
  async function processPromptSubmission(proceedCallback) {
    if (!isShieldEnabled || isSanitizing) {
      proceedCallback();
      return;
    }

    const inputEl = findPromptInput();
    if (!inputEl) {
      proceedCallback();
      return;
    }

    const rawText = getInputValue(inputEl);
    if (!rawText || rawText.trim().length === 0) {
      proceedCallback();
      return;
    }

    isSanitizing = true;
    const result = await sanitizeText(rawText);
    isSanitizing = false;

    if (result === null) {
      // Proxy offline notification
      showToast(
        'CloakLLM Offline',
        `Proxy unreachable at ${proxyUrl}. Start with 'cloakllm start' to enable sovereign protection.`,
        true
      );
      proceedCallback();
      return;
    }

    if (result && result.entities && result.entities.length > 0) {
      setInputValue(inputEl, result.sanitized);
      const typesSummary = result.entities.map((ent) => `[${ent.type}]`).join(', ');
      showToast(
        'CloakLLM Shield Protected',
        `Masked ${result.entities.length} sensitive entities: ${typesSummary}. 0 plaintext sent to cloud.`
      );

      // Notify background of blocked entities
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({
          type: 'INCREMENT_COUNT',
          count: result.entities.length,
        });
      }
    }

    setTimeout(() => {
      proceedCallback();
    }, 50);
  }

  // Intercept prompt submission on Enter key
  function handleKeyDown(e) {
    if (isSanitizing) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      const inputEl = findPromptInput();
      if (!inputEl) return;

      const rawText = getInputValue(inputEl);
      if (!rawText || rawText.trim().length === 0) return;

      e.preventDefault();
      e.stopPropagation();

      processPromptSubmission(() => {
        const sendBtn = findSendButton();
        if (sendBtn && !sendBtn.disabled) {
          sendBtn.click();
        } else {
          isSanitizing = true;
          inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
          isSanitizing = false;
        }
      });
    }
  }

  // Intercept clicks on Send buttons
  function handleClick(e) {
    if (isSanitizing) return;
    const target = e.target;
    if (!target) return;

    const btn = target.closest(
      'button[data-testid="send-button"], button[aria-label*="Send" i], button[aria-label*="Envoyer" i], form button[type="submit"]'
    );
    if (!btn) return;

    const inputEl = findPromptInput();
    if (!inputEl) return;

    const rawText = getInputValue(inputEl);
    if (!rawText || rawText.trim().length === 0) return;

    e.preventDefault();
    e.stopPropagation();

    processPromptSubmission(() => {
      isSanitizing = true;
      btn.click();
      isSanitizing = false;
    });
  }

  // Intercept form submit
  function handleSubmit(e) {
    if (isSanitizing) return;
    const inputEl = findPromptInput();
    if (!inputEl) return;

    const rawText = getInputValue(inputEl);
    if (!rawText || rawText.trim().length === 0) return;

    e.preventDefault();
    e.stopPropagation();

    processPromptSubmission(() => {
      isSanitizing = true;
      e.target.submit();
      isSanitizing = false;
    });
  }

  // Initialize
  function init() {
    ensureBadge();
    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('click', handleClick, true);
    document.addEventListener('submit', handleSubmit, true);

    // Observer to re-inject badge on navigation / SPA re-renders
    const observer = new MutationObserver(() => {
      ensureBadge();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

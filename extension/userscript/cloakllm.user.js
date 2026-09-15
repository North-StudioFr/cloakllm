// ==UserScript==
// @name         CloakLLM Sovereign AI Privacy Shield
// @namespace    https://github.com/cloakllm/cloakllm
// @version      2.0.0
// @description  Local GDPR privacy firewall and prompt anonymizer for ChatGPT, Claude, and Open WebUI.
// @author       CloakLLM Open Source Project
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @match        https://claude.ai/*
// @match        http://localhost/*
// @match        http://127.0.0.1/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const PROXY_URL = 'http://127.0.0.1:8080';
  let isShieldEnabled = true;
  let isSanitizing = false;

  function showToast(title, body, isWarning = false) {
    const existing = document.querySelector('.cloakllm-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'cloakllm-toast';
    toast.style.position = 'fixed';
    toast.style.bottom = '24px';
    toast.style.right = '24px';
    toast.style.background = '#09090b';
    toast.style.color = isWarning ? '#f59e0b' : '#10b981';
    toast.style.border = `1px solid ${isWarning ? '#f59e0b' : '#10b981'}`;
    toast.style.borderRadius = '8px';
    toast.style.padding = '12px 18px';
    toast.style.fontSize = '12px';
    toast.style.fontFamily = 'monospace';
    toast.style.zIndex = '999999';
    toast.style.boxShadow = '0 8px 24px rgba(0,0,0,0.6)';
    toast.innerHTML = `<strong>${isWarning ? '⚠️' : '🛡️'} ${title}</strong><br><span style="color:#a1a1aa;">${body}</span>`;

    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  function findPromptInput() {
    const chatgptTextarea = document.querySelector('#prompt-textarea');
    if (chatgptTextarea) return chatgptTextarea;

    const claudeEditor = document.querySelector('div.ProseMirror[contenteditable="true"]');
    if (claudeEditor) return claudeEditor;

    const textareas = document.querySelectorAll('textarea');
    for (const ta of textareas) {
      const ph = (ta.getAttribute('placeholder') || '').toLowerCase();
      if (ph.includes('message') || ph.includes('ask') || ph.includes('chat') || ph.includes('envoyer')) {
        return ta;
      }
    }
    return textareas[0] || document.querySelector('[contenteditable="true"]') || null;
  }

  function getInputValue(el) {
    if (!el) return '';
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') return el.value || '';
    return el.innerText || el.textContent || '';
  }

  function setInputValue(el, text) {
    if (!el) return;
    if (el.tagName === 'TEXTAREA') {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
      if (setter) setter.call(el, text);
      else el.value = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (el.tagName === 'INPUT') {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      if (setter) setter.call(el, text);
      else el.value = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      try {
        el.focus();
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(el);
        selection.removeAllRanges();
        selection.addRange(range);
        if (document.execCommand && document.execCommand('insertText', false, text)) {
          // done
        } else {
          el.innerText = text;
        }
      } catch {
        el.innerText = text;
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
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
      showToast('CloakLLM Offline', `Local proxy not reachable at ${PROXY_URL}. Prompt was NOT masked.`, true);
      proceedCallback();
      return;
    }

    if (result && result.entities && result.entities.length > 0) {
      setInputValue(inputEl, result.sanitized);
      const summary = result.entities.map((e) => `[${e.type}]`).join(', ');
      showToast('CloakLLM Shield Protected', `Masked ${result.entities.length} items: ${summary}. 0 plaintext sent.`);
    }

    setTimeout(() => {
      proceedCallback();
    }, 50);
  }

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
        const sendBtn =
          document.querySelector('button[data-testid="send-button"]') ||
          document.querySelector('button[aria-label*="Send" i]') ||
          document.querySelector('form button[type="submit"]');

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

  function handleClick(e) {
    if (isSanitizing) return;
    const target = e.target;
    if (!target) return;
    const btn = target.closest('button[data-testid="send-button"], button[aria-label*="Send" i], form button[type="submit"]');
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

  document.addEventListener('keydown', handleKeyDown, true);
  document.addEventListener('click', handleClick, true);
  showToast('Sovereign Shield Active', 'CloakLLM userscript monitoring prompt input.');
})();

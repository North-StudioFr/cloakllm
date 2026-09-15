# 🛡️ CloakLLM Shield Web Extension & Inline Client

> **Manifest V3 Sovereign AI Privacy Extension**  
> Intercepts and pseudonymizes sensitive prompts on ChatGPT, Claude, and Open WebUI directly in your browser before cloud transmission.

---

## 🚀 Installation Guide

### 1. Chromium Browsers (Google Chrome, Brave, Microsoft Edge, Arc)
1. Ensure your local CloakLLM proxy is running:
   ```bash
   npm start
   ```
2. In your browser, navigate to the extensions management page:
   - **Chrome / Brave:** `chrome://extensions`
   - **Edge:** `edge://extensions`
3. Enable **Developer mode** (toggle in the top right corner).
4. Click **Load unpacked** (or "Charger l'extension non empaquetée").
5. Select the `extension/` directory from this repository.
6. The 🛡️ **CloakLLM Shield** icon will appear in your extensions toolbar.

### 2. Mozilla Firefox
1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on...** (or "Charger un module temporaire").
3. Select `extension/manifest.json`.

---

## 🕹️ Supported AI Web Interfaces

- **ChatGPT** (`https://chatgpt.com/`): Intercepts prompt submissions, masks SSN, NIR, IBAN, and credit cards, and replaces them with reversible placeholders `[PERSON_1]`, `[IBAN_1]`, etc.
- **Claude** (`https://claude.ai/`): Seamless ProseMirror contenteditable DOM synchronization.
- **LibreChat / Open WebUI / Local AI** (`http://localhost:*`): Native local web UI protection.

---

## ⚡ Instant Zero-Install Fallbacks (Bookmarklet & Userscript)

If you cannot install browser extensions due to corporate IT restrictions:

### Option A: Userscript (Tampermonkey / Violentmonkey)
1. Install [Tampermonkey](https://www.tampermonkey.net/) or Violentmonkey.
2. Add a new script and paste the contents of `extension/userscript/cloakllm.user.js`.
3. CloakLLM Shield will automatically activate whenever you visit ChatGPT, Claude, or Open WebUI.

### Option B: Bookmarklet (Console Paste)
1. Open `extension/bookmarklet/bookmarklet.js`.
2. Copy the entire file content.
3. On ChatGPT or Claude, open developer console (`F12` or `Cmd+Option+I`) and paste the code.
4. An emerald pill `🛡️ CloakLLM: Shield Attached` will confirm active protection.

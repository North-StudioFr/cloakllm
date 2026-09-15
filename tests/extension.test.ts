/**
 * Tests for CloakLLM Browser Extension & Inline Client Integration
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const extensionDir = path.join(projectRoot, 'extension');

test('Extension manifest.json is valid Manifest V3 specification for Chrome and Firefox', () => {
  const manifestPath = path.join(extensionDir, 'manifest.json');
  assert.ok(fs.existsSync(manifestPath), 'manifest.json must exist');

  const content = fs.readFileSync(manifestPath, 'utf-8');
  const manifest = JSON.parse(content);

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.name, 'CloakLLM Shield — Sovereign AI Privacy');
  assert.equal(manifest.version, '2.0.0');

  // Permissions & security checks
  assert.ok(manifest.permissions.includes('storage'));
  assert.ok(manifest.permissions.includes('activeTab'));
  assert.ok(manifest.permissions.includes('alarms'), 'alarms permission required for background health check');
  assert.ok(manifest.host_permissions.some((p: string) => p.includes('127.0.0.1')));
  // Verify host permissions do NOT specify illegal port numbers (Chrome match pattern spec)
  for (const hp of manifest.host_permissions) {
    assert.ok(!hp.includes(':8080'), 'Host permissions must not contain port numbers per Chrome extension spec');
  }

  // Verify Firefox Gecko settings
  assert.ok(manifest.browser_specific_settings?.gecko?.id, 'Firefox requires gecko.id in MV3');

  // Verify icons exist
  assert.ok(manifest.icons?.['16'] && fs.existsSync(path.join(extensionDir, manifest.icons['16'])));
  assert.ok(manifest.icons?.['48'] && fs.existsSync(path.join(extensionDir, manifest.icons['48'])));
  assert.ok(manifest.icons?.['128'] && fs.existsSync(path.join(extensionDir, manifest.icons['128'])));

  // Content scripts
  assert.ok(Array.isArray(manifest.content_scripts));
  const cs = manifest.content_scripts[0];
  assert.ok(cs.matches.some((m: string) => m.includes('chatgpt.com')));
  assert.ok(cs.matches.some((m: string) => m.includes('chat.openai.com')));
  assert.ok(cs.matches.some((m: string) => m.includes('claude.ai')));
  assert.ok(cs.matches.some((m: string) => m.includes('localhost')));

  // Verify no port numbers in content script matches
  for (const m of cs.matches) {
    assert.ok(!m.includes(':*') && !m.includes(':8080'), 'Content script matches must not specify port numbers');
  }

  // Verify referenced files exist
  for (const jsFile of cs.js) {
    assert.ok(fs.existsSync(path.join(extensionDir, jsFile)), `Content script file ${jsFile} must exist`);
  }
  for (const cssFile of cs.css) {
    assert.ok(fs.existsSync(path.join(extensionDir, cssFile)), `Content CSS file ${cssFile} must exist`);
  }

  // Popup files exist
  const popupHtml = path.join(extensionDir, manifest.action.default_popup);
  assert.ok(fs.existsSync(popupHtml), 'Popup HTML must exist');
});

test('Extension popup HTML, CSS, and JS exist and contain valid markup', () => {
  const popupHtml = path.join(extensionDir, 'popup', 'popup.html');
  const popupCss = path.join(extensionDir, 'popup', 'popup.css');
  const popupJs = path.join(extensionDir, 'popup', 'popup.js');

  assert.ok(fs.existsSync(popupHtml));
  assert.ok(fs.existsSync(popupCss));
  assert.ok(fs.existsSync(popupJs));

  const html = fs.readFileSync(popupHtml, 'utf-8');
  assert.ok(html.includes('shieldToggle'));
  assert.ok(html.includes('statusBadge'));
  assert.ok(html.includes('entitiesCount'));
  assert.ok(html.includes('testBtn'));

  const js = fs.readFileSync(popupJs, 'utf-8');
  assert.ok(js.includes('/api/sanitize'));
  assert.ok(js.includes('shieldEnabled'));
});

test('Extension content script contains robust interception and toast logic', () => {
  const contentJs = path.join(extensionDir, 'content', 'content.js');
  assert.ok(fs.existsSync(contentJs));

  const js = fs.readFileSync(contentJs, 'utf-8');
  assert.ok(js.includes('#prompt-textarea')); // ChatGPT
  assert.ok(js.includes('ProseMirror')); // Claude
  assert.ok(js.includes('/api/sanitize'));
  assert.ok(js.includes('cloakllm-badge'));
  assert.ok(js.includes('cloakllm-toast'));
  assert.ok(js.includes('INCREMENT_COUNT'));
  assert.ok(js.includes('click')); // Mouse submit interception
  assert.ok(js.includes('submit')); // Form submit interception
  assert.ok(js.includes('HTMLTextAreaElement')); // React controlled state sync
});

test('Zero-install bookmarklet and userscript fallback scripts exist and are valid syntax', () => {
  const bookmarkletPath = path.join(extensionDir, 'bookmarklet', 'bookmarklet.js');
  assert.ok(fs.existsSync(bookmarkletPath));

  const bookmarkletScript = fs.readFileSync(bookmarkletPath, 'utf-8');
  assert.ok(bookmarkletScript.includes('/api/sanitize'));
  assert.ok(bookmarkletScript.includes('CloakLLM'));
  assert.ok(bookmarkletScript.includes('window.__cloakllm_injected'));

  // Ensure bookmarklet is syntactically valid JavaScript
  assert.doesNotThrow(() => {
    new Function(bookmarkletScript);
  });

  const userscriptPath = path.join(extensionDir, 'userscript', 'cloakllm.user.js');
  assert.ok(fs.existsSync(userscriptPath));

  const userscriptCode = fs.readFileSync(userscriptPath, 'utf-8');
  assert.ok(userscriptCode.includes('==UserScript=='));
  assert.ok(userscriptCode.includes('/api/sanitize'));
  assert.ok(userscriptCode.includes('chatgpt.com'));

  // Ensure userscript is syntactically valid JavaScript
  assert.doesNotThrow(() => {
    new Function(userscriptCode);
  });
});

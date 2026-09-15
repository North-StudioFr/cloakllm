import test from 'node:test';
import assert from 'node:assert';
import { CanaryEngine } from '../src/canary.ts';

test('CanaryEngine generates cryptographically signed tokens matching format', () => {
  const engine = new CanaryEngine({ secretKey: 'enterprise-canary-secret' });
  const token = engine.generateCanary('SECRET_DOC');

  assert.ok(token.startsWith('CL-CANARY-SECRET_DOC-'));
  assert.ok(token.length >= 25);
});

test('CanaryEngine detects active injected tokens in text', () => {
  const engine = new CanaryEngine({ secretKey: 'enterprise-canary-secret' });
  const token1 = engine.generateCanary('KEY');
  const token2 = engine.generateCanary('PASSWORD');

  const leakedText = `The model responded: My system instructions contained ${token1}, here it is!`;
  const result = engine.scanForCanaries(leakedText);

  assert.strictEqual(result.leakDetected, true);
  assert.strictEqual(result.matchedTokens.length, 1);
  assert.strictEqual(result.matchedTokens[0], token1);
});

test('CanaryEngine ignores foreign or fake tokens not issued by this instance', () => {
  const engine = new CanaryEngine();
  const foreignToken = 'CL-CANARY-FAKE-0123456789abcdef';

  const result = engine.scanForCanaries(`Some text with ${foreignToken}`);
  assert.strictEqual(result.leakDetected, false);
  assert.strictEqual(result.matchedTokens.length, 0);
});

test('CanaryEngine injects sentinel marker cleanly into prompt', () => {
  const engine = new CanaryEngine();
  const { content, canary } = engine.injectCanary('You are a helpful coding assistant.', 'SENTINEL');

  assert.ok(content.includes('SECURITY_SENTINEL'));
  assert.ok(content.includes(canary));

  const scan = engine.scanForCanaries(content);
  assert.strictEqual(scan.leakDetected, true);
  assert.strictEqual(scan.matchedTokens[0], canary);
});

import test from 'node:test';
import assert from 'node:assert';
import { StreamDeanonymizer } from '../src/deanonymizer.ts';
import { SessionVault } from '../src/vault.ts';

test('StreamDeanonymizer handles normal un-split chunks', () => {
  const vault = new SessionVault();
  vault.getPlaceholder('Thomas Bernard', 'PERSON'); // [PERSON_1]

  const s = new StreamDeanonymizer(vault);
  const c1 = s.feed('Bonjour ');
  const c2 = s.feed('[PERSON_1]');
  const c3 = s.feed(', bienvenue.');
  const end = s.flush();

  const total = c1 + c2 + c3 + end;
  assert.strictEqual(total, 'Bonjour Thomas Bernard, bienvenue.');
});

test('StreamDeanonymizer buffers and resolves placeholder split across 2 chunks', () => {
  const vault = new SessionVault();
  vault.getPlaceholder('Sophie Laurent', 'PERSON'); // [PERSON_1]

  const s = new StreamDeanonymizer(vault);

  // Chunk 1 has part of the placeholder: "[PERS"
  const out1 = s.feed('Veuillez contacter [PERS');
  // At this point, "Veuillez contacter " should be emitted, and "[PERS" buffered
  assert.strictEqual(out1, 'Veuillez contacter ');

  // Chunk 2 completes the placeholder: "ON_1] dès maintenant."
  const out2 = s.feed('ON_1] dès maintenant.');
  // The placeholder should be resolved to Sophie Laurent
  assert.strictEqual(out2, 'Sophie Laurent dès maintenant.');

  const end = s.flush();
  assert.strictEqual(end, '');

  assert.strictEqual(out1 + out2 + end, 'Veuillez contacter Sophie Laurent dès maintenant.');
});

test('StreamDeanonymizer handles placeholder split across 3 fine-grained token chunks', () => {
  const vault = new SessionVault();
  vault.getPlaceholder('50 000 €', 'AMOUNT'); // [AMOUNT_1]

  const s = new StreamDeanonymizer(vault);

  const out1 = s.feed('Total: [');
  const out2 = s.feed('AMOUNT_');
  const out3 = s.feed('1] TTC');
  const end = s.flush();

  assert.strictEqual(out1, 'Total: ');
  assert.strictEqual(out2, '');
  assert.strictEqual(out3, '50 000 € TTC');
  assert.strictEqual(out1 + out2 + out3 + end, 'Total: 50 000 € TTC');
});

test('StreamDeanonymizer safely flushes regular bracketed text like markdown links', () => {
  const vault = new SessionVault();
  vault.getPlaceholder('Jean', 'PERSON'); // [PERSON_1]

  const s = new StreamDeanonymizer(vault);

  // A long markdown link title that exceeds MAX_PLACEHOLDER_LEN (35 chars)
  const longBracketText = '[Cliquez ici pour consulter le guide complet de sécurité RGPD](https://example.com)';
  let out = '';
  // Stream in 5-char increments to simulate fine-grained streaming tokens
  for (let i = 0; i < longBracketText.length; i += 5) {
    out += s.feed(longBracketText.substring(i, i + 5));
  }
  out += s.flush();

  assert.strictEqual(out, longBracketText);
});

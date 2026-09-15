import test from 'node:test';
import assert from 'node:assert';
import { Deanonymizer, StreamDeanonymizer } from '../src/deanonymizer.ts';
import { SessionVault } from '../src/vault.ts';

test('Deanonymizer restores all placeholders back to original values', () => {
  const vault = new SessionVault();
  const p1 = vault.getPlaceholder('Thomas Bernard', 'PERSON');
  const a1 = vault.getPlaceholder('45 000 €', 'AMOUNT');
  const i1 = vault.getPlaceholder('FR89 3000 3012 3456 7890 1234 567', 'IBAN');

  const llmResponse = `Confirmation : le virement de ${a1} pour ${p1} a été exécuté sur le compte ${i1}.`;
  const restored = Deanonymizer.deanonymizeText(llmResponse, vault);

  assert.strictEqual(
    restored,
    'Confirmation : le virement de 45 000 € pour Thomas Bernard a été exécuté sur le compte FR89 3000 3012 3456 7890 1234 567.'
  );
});

test('Deanonymizer handles LLM casing variations (case-insensitivity)', () => {
  const vault = new SessionVault();
  vault.getPlaceholder('Alice Martin', 'PERSON'); // [PERSON_1]

  // Some LLMs output lowercase or capitalized placeholders like [person_1] or [Person_1]
  const variations = [
    'Bonjour [person_1], comment allez-vous ?',
    'Bonjour [Person_1], comment allez-vous ?',
    'Bonjour [PERSON_1], comment allez-vous ?',
  ];

  for (const variant of variations) {
    const restored = Deanonymizer.deanonymizeText(variant, vault);
    assert.strictEqual(restored, 'Bonjour Alice Martin, comment allez-vous ?');
  }
});

test('Deanonymizer preserves unknown placeholders and markdown links safely', () => {
  const vault = new SessionVault();
  vault.getPlaceholder('Alice', 'PERSON');

  const textWithMarkdown = 'Consultez la [Documentation](https://example.com) ou le ticket [ISSUE_99].';
  const restored = Deanonymizer.deanonymizeText(textWithMarkdown, vault);

  // [Documentation](...) and [ISSUE_99] should NOT be mangled
  assert.strictEqual(restored, textWithMarkdown);
});

test('Regression: StreamDeanonymizer resolves double brackets and nested brackets correctly', () => {
  const vault = new SessionVault();
  vault.getPlaceholder('Jean Dupont', 'PERSON'); // [PERSON_1]

  const s1 = new StreamDeanonymizer(vault);
  const out1 = s1.feed('Attention : [[PERSON_1]]') + s1.flush();
  assert.strictEqual(out1, 'Attention : [Jean Dupont]');

  const s2 = new StreamDeanonymizer(vault);
  const out2 = s2.feed('Voir [note [PERSON_1]]') + s2.flush();
  assert.strictEqual(out2, 'Voir [note Jean Dupont]');
});

test('Regression: StreamDeanonymizer does not delay regular bracketed text with spaces', () => {
  const vault = new SessionVault();
  vault.getPlaceholder('Jean Dupont', 'PERSON');

  const s = new StreamDeanonymizer(vault);
  // An unclosed bracket containing spaces should NOT be buffered waiting for 35 chars
  const out = s.feed('[ Information non sensible ');
  assert.strictEqual(out, '[ Information non sensible ');
});

test('Deanonymizer and StreamDeanonymizer handle hyphenated and alphanumeric entity types', () => {
  const vault = new SessionVault();
  const emp = vault.getPlaceholder('EMP-98765', 'EMPLOYEE-ID');
  const proj = vault.getPlaceholder('Project Titan V2', 'PROJ2');
  const ip = vault.getPlaceholder('10.0.1.5', 'INTERNAL_IP_V4');

  assert.equal(emp, '[EMPLOYEE-ID_1]');
  assert.equal(proj, '[PROJ2_1]');
  assert.equal(ip, '[INTERNAL_IP_V4_1]');

  // Static de-anonymization
  const rawMsg = `Deploy ${proj} for ${emp} to ${ip}.`;
  const staticResult = Deanonymizer.deanonymizeText(rawMsg, vault);
  assert.equal(staticResult, 'Deploy Project Titan V2 for EMP-98765 to 10.0.1.5.');

  // Streaming de-anonymization with chunk-split boundaries
  const stream = new StreamDeanonymizer(vault);
  const c1 = stream.feed('Deploy [PROJ');
  const c2 = stream.feed('2_1] for [EMPLOYEE-');
  const c3 = stream.feed('ID_1] to [INTERNAL_IP_V4_');
  const c4 = stream.feed('1].');
  const end = stream.flush();

  const streamResult = c1 + c2 + c3 + c4 + end;
  assert.equal(streamResult, 'Deploy Project Titan V2 for EMP-98765 to 10.0.1.5.');
});


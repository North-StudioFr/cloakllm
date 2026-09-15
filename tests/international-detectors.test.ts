import test from 'node:test';
import assert from 'node:assert';
import { IdentityDetector, isValidUS_SSN, isValidUK_NINO } from '../src/detectors/identity.ts';
import { RegexDetector } from '../src/detectors/regex-detector.ts';
import { NerHeuristicDetector } from '../src/detectors/ner-heuristics.ts';
import { Anonymizer } from '../src/anonymizer.ts';
import { Deanonymizer } from '../src/deanonymizer.ts';
import { SessionVault } from '../src/vault.ts';
import { MasterDetector } from '../src/detectors/index.ts';

test('IdentityDetector validates US SSN correctly and rejects invalid patterns', () => {
  // Valid SSNs
  assert.strictEqual(isValidUS_SSN('123-45-6789'), true);
  assert.strictEqual(isValidUS_SSN('045 23 8901'), true);
  assert.strictEqual(isValidUS_SSN('219-09-9999'), true);

  // Invalid area numbers
  assert.strictEqual(isValidUS_SSN('000-45-6789'), false); // 000 is invalid
  assert.strictEqual(isValidUS_SSN('666-45-6789'), false); // 666 is invalid
  assert.strictEqual(isValidUS_SSN('900-45-6789'), false); // 900+ is invalid
  assert.strictEqual(isValidUS_SSN('999-45-6789'), false); // 999 is invalid

  // Invalid group numbers
  assert.strictEqual(isValidUS_SSN('123-00-6789'), false); // 00 group is invalid

  // Invalid serial numbers
  assert.strictEqual(isValidUS_SSN('123-45-0000'), false); // 0000 serial is invalid

  const detector = new IdentityDetector();
  const text = 'Employee SSN is 123-45-6789 and invalid 000-12-3456 should be ignored.';
  const entities = detector.detect(text);

  const ssns = entities.filter(e => e.type === 'SSN');
  assert.strictEqual(ssns.length, 1);
  assert.strictEqual(ssns[0].value, '123-45-6789');
  assert.strictEqual(ssns[0].metadata?.country, 'US');
});

test('IdentityDetector validates UK NINO correctly and rejects invalid prefixes', () => {
  // Valid NINOs
  assert.strictEqual(isValidUK_NINO('QQ 12 34 56 A'), true); // HMRC test NINO
  assert.strictEqual(isValidUK_NINO('JH392187B'), true);
  assert.strictEqual(isValidUK_NINO('AB 12 34 56 C'), true);

  // Invalid prefix letters (D, F, I, Q, U, V not allowed except test prefix QQ)
  assert.strictEqual(isValidUK_NINO('DO 12 34 56 A'), false);
  assert.strictEqual(isValidUK_NINO('FO 12 34 56 A'), false);
  assert.strictEqual(isValidUK_NINO('AO 12 34 56 A'), false); // Second letter cannot be O

  // Disallowed prefix combinations (BG, GB, KN, NK, NT, TN, ZZ)
  assert.strictEqual(isValidUK_NINO('GB 12 34 56 A'), false);
  assert.strictEqual(isValidUK_NINO('ZZ 12 34 56 A'), false);

  const detector = new IdentityDetector();
  const text = 'Patient insurance: QQ 12 34 56 A and invalid GB 12 34 56 A.';
  const entities = detector.detect(text);

  const ninos = entities.filter(e => e.type === 'NINO');
  assert.strictEqual(ninos.length, 1);
  assert.strictEqual(ninos[0].value, 'QQ 12 34 56 A');
  assert.strictEqual(ninos[0].metadata?.country, 'UK');
});

test('RegexDetector detects US and UK phone numbers accurately', () => {
  const detector = new RegexDetector();
  const text = `
    US Phones: (555) 234-5678, +1-800-555-0199, and 212-555-0143
    UK Phones: +44 20 7946 0958, 07911 123456, and 020 7946 0123
  `;
  const entities = detector.detect(text);

  const phones = entities.filter(e => e.type === 'PHONE');
  assert.ok(phones.length >= 6);

  const usPhones = phones.filter(p => p.metadata?.country === 'US');
  assert.ok(usPhones.length >= 3);
  assert.ok(usPhones.some(p => p.value.includes('(555) 234-5678')));
  assert.ok(usPhones.some(p => p.value.includes('212-555-0143')));

  const ukPhones = phones.filter(p => p.metadata?.country === 'UK');
  assert.ok(ukPhones.length >= 3);
  assert.ok(ukPhones.some(p => p.value.includes('+44 20 7946 0958')));
  assert.ok(ukPhones.some(p => p.value.includes('07911 123456')));
});

test('NerHeuristicDetector detects English honorifics and corporate entities', () => {
  const detector = new NerHeuristicDetector();
  const text = `
    Dear Mr. John Smith and Dr. Jane Watson from Apex Solutions LLC and Beta Tech Ltd.
    Customer: Robert Langdon representing Global Bank PLC and Acme Corp.
  `;
  const entities = detector.detect(text);

  const persons = entities.filter(e => e.type === 'PERSON');
  assert.ok(persons.length >= 3);
  assert.ok(persons.some(p => p.value === 'John Smith'));
  assert.ok(persons.some(p => p.value === 'Jane Watson'));
  assert.ok(persons.some(p => p.value === 'Robert Langdon'));

  const orgs = entities.filter(e => e.type === 'ORGANIZATION');
  assert.ok(orgs.length >= 4);
  assert.ok(orgs.some(o => o.value === 'Apex Solutions LLC'));
  assert.ok(orgs.some(o => o.value === 'Beta Tech Ltd'));
  assert.ok(orgs.some(o => o.value === 'Global Bank PLC'));
  assert.ok(orgs.some(o => o.value === 'Acme Corp'));
});

test('Anonymizer and Deanonymizer handle US & UK PII end-to-end with deterministic consistency', () => {
  const master = new MasterDetector();
  const anonymizer = new Anonymizer(master);
  const vault = new SessionVault();

  const prompt = 'Please verify Mr. John Smith with SSN 123-45-6789 and NINO QQ 12 34 56 A from Acme Corp.';
  const result = anonymizer.anonymizeText(prompt, vault);

  // Must contain placeholders
  assert.ok(result.sanitized.includes('[PERSON_1]'));
  assert.ok(result.sanitized.includes('[SSN_1]'));
  assert.ok(result.sanitized.includes('[NINO_1]'));
  assert.ok(result.sanitized.includes('[ORGANIZATION_1]'));

  // Cloud should not see raw values
  assert.strictEqual(result.sanitized.includes('John Smith'), false);
  assert.strictEqual(result.sanitized.includes('123-45-6789'), false);
  assert.strictEqual(result.sanitized.includes('QQ 12 34 56 A'), false);
  assert.strictEqual(result.sanitized.includes('Acme Corp'), false);

  // De-anonymize restores original values
  const restored = Deanonymizer.deanonymizeText(result.sanitized, vault);
  assert.strictEqual(restored, prompt);
});

test('IdentityDetector & RegexDetector handle dot-separated SSN and unspaced/toll-free US phones', () => {
  const idDetector = new IdentityDetector();
  const resSSN = idDetector.detect('Employee identifier 123.45.6789 registered.');
  assert.strictEqual(resSSN.length, 1);
  assert.strictEqual(resSSN[0].type, 'SSN');
  assert.strictEqual(resSSN[0].value, '123.45.6789');

  const regDetector = new RegexDetector();
  const resPhone = regDetector.detect('Contact numbers: (555)234-5678 and 1-800-555-0199 for dispatch.');
  const usPhones = resPhone.filter(p => p.type === 'PHONE' && p.metadata?.country === 'US');
  assert.strictEqual(usPhones.length, 2);
  assert.ok(usPhones.some(p => p.value === '(555)234-5678'));
  assert.ok(usPhones.some(p => p.value === '1-800-555-0199'));
});

test('NerHeuristicDetector handles Professor, Doctor, and full greeting names', () => {
  const detector = new NerHeuristicDetector();
  const text = 'Professor Alan Turing met Doctor Watson and Dear Alice Smith.';
  const entities = detector.detect(text);

  const persons = entities.filter(e => e.type === 'PERSON');
  assert.strictEqual(persons.length, 3);
  assert.ok(persons.some(p => p.value === 'Alan Turing'));
  assert.ok(persons.some(p => p.value === 'Watson'));
  assert.ok(persons.some(p => p.value === 'Alice Smith'));
});

test('Anonymizer prioritizes longer vault mappings to avoid partial name leaks', () => {
  const anonymizer = new Anonymizer();
  const vault = new SessionVault();

  // Seed vault with sub-word first, then full name
  vault.getPlaceholder('Smith', 'PERSON');
  vault.getPlaceholder('John Smith', 'PERSON');

  const result = anonymizer.anonymizeText('Please assign this task to John Smith.', vault);
  assert.strictEqual(result.sanitized.includes('John'), false, 'Leaked John due to shorter mapping shadowing!');
  assert.ok(result.sanitized.includes('[PERSON_2]'));

  const restored = Deanonymizer.deanonymizeText(result.sanitized, vault);
  assert.strictEqual(restored, 'Please assign this task to John Smith.');
});

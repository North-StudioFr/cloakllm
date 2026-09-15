import test from 'node:test';
import assert from 'node:assert';
import { DocumentScanner } from '../src/document-scanner.ts';
import { SessionVault } from '../src/vault.ts';

test('DocumentScanner parses and sanitizes CSV tables cell-by-cell', () => {
  const scanner = new DocumentScanner();
  const vault = new SessionVault();

  const csv = `id,name,email,amount\n1,"M. Jean Dupont",jean@corp.com,1500 €\n2,"Mme Alice Martin",alice@corp.com,2300 €`;
  const result = scanner.scanDocument(csv, 'users.csv', vault);

  assert.strictEqual(result.format, 'csv');
  assert.strictEqual(result.entities.length, 6); // 2 persons, 2 emails, 2 amounts
  assert.ok(!result.sanitizedContent.includes('jean@corp.com'));
  assert.ok(!result.sanitizedContent.includes('Jean Dupont'));
  assert.ok(result.sanitizedContent.includes('[EMAIL_1]'));
  assert.ok(result.sanitizedContent.includes('[PERSON_1]'));
});

test('DocumentScanner parses and sanitizes structured JSON recursively', () => {
  const scanner = new DocumentScanner();
  const vault = new SessionVault();

  const jsonDoc = JSON.stringify({
    client: 'M. Jean Dupont',
    contact: {
      email: 'jean@dupont.fr',
      phone: '06 12 34 56 78',
    },
    meta: {
      secretToken: 'sk-proj-1234567890abcdef12345678',
    },
  });

  const result = scanner.scanDocument(jsonDoc, 'payload.json', vault);
  assert.strictEqual(result.format, 'json');

  const parsed = JSON.parse(result.sanitizedContent);
  assert.ok(parsed.client.includes('[PERSON_1]'));
  assert.ok(parsed.contact.email.includes('[EMAIL_1]'));
  assert.ok(parsed.contact.phone.includes('[PHONE_1]'));
  assert.ok(parsed.meta.secretToken.includes('[SECRET_1]'));
});

test('DocumentScanner sanitizes HTML / XML preserving tags and attribute structure', () => {
  const scanner = new DocumentScanner();
  const vault = new SessionVault();

  const html = `<div class="user-card"><h1>Contact M. Jean Dupont</h1><p>Email: <a href="mailto:jean@dupont.fr">jean@dupont.fr</a></p></div>`;
  const result = scanner.scanDocument(html, 'index.html', vault);

  assert.strictEqual(result.format, 'html');
  assert.ok(result.sanitizedContent.includes('<div class="user-card">'));
  assert.ok(result.sanitizedContent.includes('<a href="mailto:jean@dupont.fr">'));
  assert.ok(!result.sanitizedContent.includes('Contact M. Jean Dupont'));
  assert.ok(result.sanitizedContent.includes('[PERSON_1]'));
});

test('DocumentScanner sanitizes RFC 822 Email (.eml) headers and body', () => {
  const scanner = new DocumentScanner();
  const vault = new SessionVault();

  const eml = `From: Jean Dupont <jean@dupont.fr>\nTo: Alice Martin <alice@martin.fr>\nSubject: Virement de 500 € pour Jean\n\nBonjour Alice,\nMerci d'envoyer 500 € à mon compte.\nCdt, Jean Dupont`;
  const result = scanner.scanDocument(eml, 'message.eml', vault);

  assert.strictEqual(result.format, 'eml');
  assert.ok(result.sanitizedContent.startsWith('From:'));
  assert.ok(!result.sanitizedContent.includes('jean@dupont.fr'));
  assert.ok(!result.sanitizedContent.includes('alice@martin.fr'));
});

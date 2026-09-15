import test from 'node:test';
import assert from 'node:assert';
import { RegexDetector } from '../src/detectors/regex-detector.ts';
import { FinancialDetector, isValidIBAN } from '../src/detectors/financial.ts';
import { IdentityDetector, isValidNIR, isValidLuhn } from '../src/detectors/identity.ts';
import { CreditCardDetector } from '../src/detectors/credit-card.ts';
import { SecretsDetector } from '../src/detectors/secrets.ts';
import { NerHeuristicDetector } from '../src/detectors/ner-heuristics.ts';
import { MasterDetector } from '../src/detectors/index.ts';

test('RegexDetector detects emails and phone numbers correctly', () => {
  const detector = new RegexDetector();
  const text = 'Contactez john.doe+support@example.co.uk ou au 06 12 34 56 78 ou +33 1 42 68 55 00';
  const entities = detector.detect(text);

  const emails = entities.filter(e => e.type === 'EMAIL');
  assert.strictEqual(emails.length, 1);
  assert.strictEqual(emails[0].value, 'john.doe+support@example.co.uk');

  const phones = entities.filter(e => e.type === 'PHONE');
  assert.strictEqual(phones.length, 2);
  assert.ok(phones.some(p => p.value.includes('06 12 34 56 78')));
  assert.ok(phones.some(p => p.value.includes('+33 1 42 68 55 00')));
});

test('FinancialDetector detects amounts and validates IBAN with Modulo 97', () => {
  // Valid French IBAN with modulo 97 check digits
  const validIban = 'FR89 3000 3012 3456 7890 1234 567';
  assert.strictEqual(isValidIBAN(validIban), true);

  // Invalid IBAN (tampered check digit)
  const invalidIban = 'FR99 3000 3012 3456 7890 1234 567';
  assert.strictEqual(isValidIBAN(invalidIban), false);

  const detector = new FinancialDetector();
  const text = `Le virement de 450 000 € ou 12,500.50 $ vers l'IBAN ${validIban} a été validé.`;
  const entities = detector.detect(text);

  const ibans = entities.filter(e => e.type === 'IBAN');
  assert.strictEqual(ibans.length, 1);
  assert.strictEqual(ibans[0].value, validIban);

  const amounts = entities.filter(e => e.type === 'AMOUNT');
  assert.strictEqual(amounts.length, 2);
});

test('IdentityDetector detects and validates French NIR (Secu)', () => {
  // Valid NIR: 1 85 05 75 108 123 80 (calculated key: 97 - (1850575108123 % 97) = 97 - 17 = 80)
  const validNir = '1 85 05 75 108 123 80';
  assert.strictEqual(isValidNIR(validNir), true);

  // Invalid key: 99 instead of 80
  const invalidNir = '1 85 05 75 108 123 99';
  assert.strictEqual(isValidNIR(invalidNir), false);

  const detector = new IdentityDetector();
  const text = `Le patient a pour NIR : ${validNir}.`;
  const entities = detector.detect(text);

  assert.strictEqual(entities.length, 1);
  assert.strictEqual(entities[0].type, 'NIR');
  assert.strictEqual(entities[0].value, validNir);
});

test('CreditCardDetector detects valid cards with Luhn check and rejects invalid ones', () => {
  // Valid Luhn test card (standard Visa test number 4532 0150 0000 0003)
  // Let's compute a guaranteed Luhn card:
  // 4532 1234 5678 9010 -> Let's check with isValidLuhn
  assert.strictEqual(isValidLuhn('4532 0150 0000 0003'), false); // Let's check a standard valid one
  // 4992 7398 716 is a classic Luhn valid number
  // Let's create a known valid Visa card: 4000 0012 3456 7819
  // 4, 0, 0, 0,  0, 0, 1, 2,  3, 4, 5, 6,  7, 8, 1, 9
  // doubled: (4*2=8), 0, (0), 0, (0), 0, (1*2=2), 2, (3*2=6), 4, (5*2=10->1), 6, (7*2=14->5), 8, (1*2=2), 9
  // sum: 8+0+0+0+0+0+2+2+6+4+1+6+5+8+2+9 = 53 -> key to make 60 is 7:
  // Let's verify standard 4539 1488 0343 6467
  const validVisa = '4539 1488 0343 6467';
  const isLuhn = isValidLuhn(validVisa);
  assert.strictEqual(isLuhn, true);

  const detector = new CreditCardDetector();
  const text = `Paiement avec la carte ${validVisa} ou fausse carte 4111 1111 1111 1112.`;
  const entities = detector.detect(text);

  assert.strictEqual(entities.length, 1);
  assert.strictEqual(entities[0].type, 'CREDIT_CARD');
  assert.strictEqual(entities[0].value, validVisa);
  assert.strictEqual(entities[0].metadata?.issuer, 'VISA');
});

test('SecretsDetector detects API keys, tokens and credentials', () => {
  const detector = new SecretsDetector();
  const text = `
    OpenAI: sk-proj-1234567890abcdefghijklmnopqrstuvwxyz
    GitHub: ghp_1234567890abcdefghijklmnopqrstuvwxyz12
    AWS: AKIAIOSFODNN7EXAMPLE
    Token: Bearer mySecretTokenWithMoreThanTwentyCharsLength==
  `;
  const entities = detector.detect(text);

  assert.ok(entities.length >= 4);
  assert.ok(entities.some(e => e.value.startsWith('sk-proj-')));
  assert.ok(entities.some(e => e.value.startsWith('ghp_')));
  assert.ok(entities.some(e => e.value === 'AKIAIOSFODNN7EXAMPLE'));
  assert.ok(entities.some(e => e.metadata?.secretType === 'BEARER_TOKEN'));
});

test('NerHeuristicDetector detects persons with honorifics and corporate orgs', () => {
  const detector = new NerHeuristicDetector();
  const text = 'Bonjour, je transmets le dossier de M. Thomas Bernard à la société Capgemini et au Cabinet Alpha SARL.';
  const entities = detector.detect(text);

  const persons = entities.filter(e => e.type === 'PERSON');
  assert.strictEqual(persons.length, 1);
  assert.strictEqual(persons[0].value, 'Thomas Bernard');

  const orgs = entities.filter(e => e.type === 'ORGANIZATION');
  assert.strictEqual(orgs.length, 2);
  assert.ok(orgs.some(o => o.value.toLowerCase().includes('capgemini')));
  assert.ok(orgs.some(o => o.value.toLowerCase().includes('cabinet alpha sarl')));
});

test('MasterDetector resolves overlaps cleanly with prioritization', () => {
  const master = new MasterDetector();
  // An API key that might contain numbers or words
  const text = 'Clé secrète sk-1234567890abcdefghijklmnopqr pour le compte de M. Jean Dupont.';
  const entities = master.detect(text);

  assert.strictEqual(entities.length, 2);
  assert.strictEqual(entities[0].type, 'SECRET');
  assert.strictEqual(entities[1].type, 'PERSON');
  assert.strictEqual(entities[1].value, 'Jean Dupont');
});

test('Regression: RegexDetector captures IP addresses preceded by words with letter v', () => {
  const detector = new RegexDetector();
  const text = 'Serveur: 192.168.1.1, IPv4: 10.0.0.1, et voici l\'IP 172.16.0.254 versus version 1.2.3.4 et v2.0.0.1';
  const entities = detector.detect(text);

  const ips = entities.filter(e => e.type === 'IP_ADDRESS');
  assert.strictEqual(ips.length, 3);
  assert.ok(ips.some(ip => ip.value === '192.168.1.1'));
  assert.ok(ips.some(ip => ip.value === '10.0.0.1'));
  assert.ok(ips.some(ip => ip.value === '172.16.0.254'));
  // Versions v1.2.3.4 and v2.0.0.1 must NOT be detected as IP
  assert.strictEqual(ips.some(ip => ip.value === '1.2.3.4'), false);
  assert.strictEqual(ips.some(ip => ip.value === '2.0.0.1'), false);
});

test('Regression: NerHeuristicDetector captures single names and ignores courtesy words', () => {
  const detector = new NerHeuristicDetector();
  const text = 'Bonjour Alice, voici les dossiers de M. Dupont et Mme Martin pour le Client: Lefebvre. Bonjour Monsieur !';
  const entities = detector.detect(text);

  const persons = entities.filter(e => e.type === 'PERSON');
  assert.strictEqual(persons.length, 4);
  assert.ok(persons.some(p => p.value === 'Alice'));
  assert.ok(persons.some(p => p.value === 'Dupont'));
  assert.ok(persons.some(p => p.value === 'Martin'));
  assert.ok(persons.some(p => p.value === 'Lefebvre'));
  // "Monsieur" must NOT be treated as a person name
  assert.strictEqual(persons.some(p => p.value.toLowerCase() === 'monsieur'), false);
});

test('Regression: IdentityDetector captures 9-digit SIREN with Luhn check', () => {
  const detector = new IdentityDetector();
  // 552032534 is valid Luhn (Google France SIREN)
  const text = 'Numéro SIREN : 552 032 534 ou SIREN 552032534.';
  const entities = detector.detect(text);

  const sirets = entities.filter(e => e.type === 'SIRET');
  assert.strictEqual(sirets.length, 2);
  assert.ok(sirets.every(s => s.metadata?.kind === 'SIREN'));
});

test('Regression: FinancialDetector captures scale expressions (millions/milliards)', () => {
  const detector = new FinancialDetector();
  const text = 'Budget alloué : 10 millions € et un contrat cadre de 5 millions d\'euros ou 2 milliards de dollars.';
  const entities = detector.detect(text);

  const amounts = entities.filter(e => e.type === 'AMOUNT');
  assert.strictEqual(amounts.length, 3);
  assert.ok(amounts.some(a => a.value.includes('10 millions €')));
  assert.ok(amounts.some(a => a.value.includes("5 millions d'euros")));
  assert.ok(amounts.some(a => a.value.includes('2 milliards de dollars')));
});

test('Regression: SecretsDetector captures Google, Stripe and HuggingFace credentials', () => {
  const detector = new SecretsDetector();
  const text = `
    Google: AIzaSyB1234567890abcdefghijklmnopqrstuv
    Stripe: sk_test_51234567890abcdefghijklmnopqrstuvwxyz
    HuggingFace: hf_abcdefghijklmnopqrstuvwxyz12345678
  `;
  const entities = detector.detect(text);

  assert.ok(entities.some(e => e.metadata?.secretType === 'GOOGLE_API_KEY'));
  assert.ok(entities.some(e => e.metadata?.secretType === 'STRIPE_SECRET_KEY'));
  assert.ok(entities.some(e => e.metadata?.secretType === 'HUGGINGFACE_TOKEN'));
});


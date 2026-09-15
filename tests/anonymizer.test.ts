import test from 'node:test';
import assert from 'node:assert';
import { Anonymizer } from '../src/anonymizer.ts';
import { SessionVault } from '../src/vault.ts';
import type { ChatMessage } from '../src/types.ts';

test('Anonymizer replaces sensitive entities and preserves consistency', () => {
  const anonymizer = new Anonymizer();
  const vault = new SessionVault();

  const text = 'Bonjour, je suis M. Pierre Martin. M. Pierre Martin souhaite envoyer 15 000 € à pierre.martin@example.com.';
  const result = anonymizer.anonymizeText(text, vault);

  // Both occurrences of Pierre Martin should map to the exact same [PERSON_1] placeholder
  assert.ok(result.sanitized.includes('[PERSON_1]'));
  const occurrences = (result.sanitized.match(/\[PERSON_1\]/g) || []).length;
  assert.strictEqual(occurrences, 2);

  // Email should map to [EMAIL_1]
  assert.ok(result.sanitized.includes('[EMAIL_1]'));

  // Amount should map to [AMOUNT_1]
  assert.ok(result.sanitized.includes('[AMOUNT_1]'));

  // No original sensitive data should exist in sanitized text
  assert.strictEqual(result.sanitized.includes('Pierre Martin'), false);
  assert.strictEqual(result.sanitized.includes('pierre.martin@example.com'), false);
  assert.strictEqual(result.sanitized.includes('15 000 €'), false);
});

test('Anonymizer handles multi-turn ChatMessages with consistent mapping', () => {
  const anonymizer = new Anonymizer();
  const vault = new SessionVault();

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: 'Tu es un assistant comptable pour la société Capgemini.',
    },
    {
      role: 'user',
      content: 'Dossier client : M. Thomas Bernard, IBAN FR89 3000 3012 3456 7890 1234 567, montant 12 500 €.',
    },
    {
      role: 'assistant',
      content: 'Bien reçu le dossier de M. Thomas Bernard.',
    },
    {
      role: 'user',
      content: 'Peux-tu confirmer le virement de 12 500 € pour M. Thomas Bernard ?',
    },
  ];

  const result = anonymizer.anonymizeMessages(messages, vault);

  assert.strictEqual(result.sanitized.length, 4);

  // Verify Thomas Bernard is mapped consistently across user and assistant messages
  const user1 = result.sanitized[1].content as string;
  const asst = result.sanitized[2].content as string;
  const user2 = result.sanitized[3].content as string;

  assert.ok(user1.includes('[PERSON_1]'));
  assert.ok(asst.includes('[PERSON_1]'));
  assert.ok(user2.includes('[PERSON_1]'));

  // Verify 12 500 € mapped consistently to [AMOUNT_1]
  assert.ok(user1.includes('[AMOUNT_1]'));
  assert.ok(user2.includes('[AMOUNT_1]'));

  // Upstream receives zero raw PII
  assert.strictEqual(user1.includes('Thomas Bernard'), false);
  assert.strictEqual(user1.includes('FR89'), false);
  assert.strictEqual(user1.includes('12 500 €'), false);
});

test('Anonymizer handles multimodal content blocks array safely', () => {
  const anonymizer = new Anonymizer();
  const vault = new SessionVault();

  const messages: ChatMessage[] = [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Mon contact : contact@entreprise.fr au 06 11 22 33 44' },
        { type: 'image_url', image_url: { url: 'https://example.com/image.png' } },
      ],
    },
  ];

  const result = anonymizer.anonymizeMessages(messages, vault);
  const blocks = result.sanitized[0].content as Array<{ type: string; text?: string }>;

  assert.strictEqual(blocks.length, 2);
  assert.ok(blocks[0].text?.includes('[EMAIL_1]'));
  assert.ok(blocks[0].text?.includes('[PHONE_1]'));
  assert.strictEqual(blocks[0].text?.includes('contact@entreprise.fr'), false);
});

test('Regression: Anonymizer catches repeated occurrences without honorifics in single string', () => {
  const anonymizer = new Anonymizer();
  const text = 'Bonjour, je vous présente M. Jean Dupont. Jean Dupont est notre directeur commercial.';
  const result = anonymizer.anonymizeText(text);

  assert.strictEqual(result.sanitized.includes('Jean Dupont'), false, 'Leaked Jean Dupont in single string!');
  const occurrences = (result.sanitized.match(/\[PERSON_1\]/g) || []).length;
  assert.strictEqual(occurrences, 2);
});

test('Regression: Anonymizer preserves multi-turn conversation consistency even when honorific is absent in later turns', () => {
  const anonymizer = new Anonymizer();
  const vault = new SessionVault();

  // Turn 1
  const turn1 = [{ role: 'user', content: 'Voici le dossier de M. Thomas Bernard.' }];
  const res1 = anonymizer.anonymizeMessages(turn1, vault);
  assert.ok((res1.sanitized[0].content as string).includes('[PERSON_1]'));

  // Turn 2: User and assistant reference Thomas Bernard without any "M."
  const turn2: ChatMessage[] = [
    { role: 'user', content: 'Voici le dossier de M. Thomas Bernard.' },
    { role: 'assistant', content: 'Bien reçu le dossier de Thomas Bernard.' },
    { role: 'user', content: 'Est-ce que Thomas Bernard a validé le devis ?' },
  ];
  const res2 = anonymizer.anonymizeMessages(turn2, vault);

  for (const msg of res2.sanitized) {
    const text = msg.content as string;
    assert.strictEqual(text.includes('Thomas Bernard'), false, 'Leaked Thomas Bernard in turn 2!');
    assert.ok(text.includes('[PERSON_1]'));
  }
});

test('Anonymizer handles function tool_calls arguments safely', () => {
  const anonymizer = new Anonymizer();
  const messages: ChatMessage[] = [
    {
      role: 'assistant',
      content: '',
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          function: {
            name: 'send_transfer',
            arguments: JSON.stringify({
              recipient: 'M. Jean Dupont',
              amount: '45 000 €',
              email: 'jean.dupont@example.com',
            }),
          },
        },
      ],
    },
  ];

  const res = anonymizer.anonymizeMessages(messages);
  const toolCall = (res.sanitized[0] as any).tool_calls[0];
  const args = JSON.parse(toolCall.function.arguments);

  assert.strictEqual(args.recipient.includes('Jean Dupont'), false);
  assert.strictEqual(args.amount.includes('45 000 €'), false);
  assert.strictEqual(args.email.includes('jean.dupont@example.com'), false);
  assert.ok(args.recipient.includes('[PERSON_1]'));
});


import test from 'node:test';
import assert from 'node:assert';
import {
  LocalNerDetector,
  resolveDefaultModel,
  resolveDefaultUrl,
} from '../src/detectors/local-provider.ts';
import { MasterDetector } from '../src/detectors/index.ts';

test('resolveDefaultUrl and resolveDefaultModel handle workstation and LAN presets', () => {
  // Workstation profile (default: 127.0.0.1)
  assert.strictEqual(resolveDefaultUrl('ollama', 'workstation'), 'http://127.0.0.1:11434');
  assert.strictEqual(resolveDefaultUrl('openai-compatible', 'workstation'), 'http://127.0.0.1:1234/v1');
  assert.strictEqual(resolveDefaultUrl('huggingface', 'workstation'), 'http://127.0.0.1:8080');

  // LAN profile (default: ai-server.local)
  assert.strictEqual(resolveDefaultUrl('ollama', 'lan'), 'http://ai-server.local:11434');
  assert.strictEqual(resolveDefaultUrl('openai-compatible', 'lan'), 'http://ai-server.local:1234/v1');
  assert.strictEqual(resolveDefaultUrl('huggingface', 'lan'), 'http://ai-server.local:8080');

  // Custom URLs override defaults
  assert.strictEqual(
    resolveDefaultUrl('openai-compatible', 'workstation', 'http://127.0.0.1:8000/v1'),
    'http://127.0.0.1:8000/v1'
  );

  // Default models
  assert.strictEqual(resolveDefaultModel('ollama'), 'llama3.2:1b');
  assert.strictEqual(resolveDefaultModel('openai-compatible'), 'local-model');
  assert.strictEqual(resolveDefaultModel('huggingface'), 'dslim/bert-base-NER');
  assert.strictEqual(resolveDefaultModel('ollama', 'mistral:7b'), 'mistral:7b');
});

test('LocalNerDetector queries OpenAI-compatible local provider (LM Studio / vLLM)', async () => {
  const mockFetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    assert.ok(url.toString().includes('/chat/completions'));
    assert.strictEqual(init?.method, 'POST');

    const body = JSON.parse((init?.body as string) || '{}');
    assert.strictEqual(body.model, 'qwen2.5-coder');

    const mockResponse = {
      id: 'chatcmpl-local-123',
      choices: [
        {
          message: {
            role: 'assistant',
            content: JSON.stringify({
              entities: [
                { type: 'PERSON', value: 'Arthur Conan Doyle' },
                { type: 'ORGANIZATION', value: 'Strand Magazine' },
              ],
            }),
          },
        },
      ],
    };

    return new Response(JSON.stringify(mockResponse), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const detector = new LocalNerDetector({
    providerType: 'openai-compatible',
    baseUrl: 'http://localhost:1234/v1',
    model: 'qwen2.5-coder',
    fetchFn: mockFetch as any,
  });

  const text = 'Published by Arthur Conan Doyle in Strand Magazine in London.';
  const entities = await detector.detectAsync(text);

  assert.strictEqual(entities.length, 2);
  assert.strictEqual(entities[0].type, 'PERSON');
  assert.strictEqual(entities[0].value, 'Arthur Conan Doyle');
  assert.strictEqual(entities[1].type, 'ORGANIZATION');
  assert.strictEqual(entities[1].value, 'Strand Magazine');
  assert.strictEqual(entities[0].metadata?.source, 'openai-compatible');
});

test('LocalNerDetector queries Hugging Face local provider with token-classification format', async () => {
  const mockFetch = async (_url: string | URL | Request, _init?: RequestInit): Promise<Response> => {
    // Standard HuggingFace TEI pipeline output array
    const mockHfResponse = [
      {
        entity_group: 'PER',
        score: 0.99,
        word: 'Marie Curie',
        start: 10,
        end: 21,
      },
      {
        entity_group: 'ORG',
        score: 0.97,
        word: 'Sorbonne University',
        start: 25,
        end: 44,
      },
    ];

    return new Response(JSON.stringify(mockHfResponse), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const detector = new LocalNerDetector({
    providerType: 'huggingface',
    baseUrl: 'http://localhost:8080',
    model: 'dslim/bert-base-NER',
    fetchFn: mockFetch as any,
  });

  const text = 'Professor Marie Curie at Sorbonne University.';
  const entities = await detector.detectAsync(text);

  assert.strictEqual(entities.length, 2);
  assert.strictEqual(entities[0].type, 'PERSON');
  assert.strictEqual(entities[0].value, 'Marie Curie');
  assert.strictEqual(entities[1].type, 'ORGANIZATION');
  assert.strictEqual(entities[1].value, 'Sorbonne University');
  assert.strictEqual(entities[0].metadata?.source, 'huggingface');
});

test('LocalNerDetector queries Hugging Face local provider with generated_text format', async () => {
  const mockFetch = async (_url: string | URL | Request, _init?: RequestInit): Promise<Response> => {
    // Standard Hugging Face text-generation JSON output
    const mockHfResponse = [
      {
        generated_text: JSON.stringify({
          entities: [{ type: 'ORGANIZATION', value: 'DeepMind' }],
        }),
      },
    ];

    return new Response(JSON.stringify(mockHfResponse), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const detector = new LocalNerDetector({
    providerType: 'huggingface',
    baseUrl: 'http://localhost:8080',
    fetchFn: mockFetch as any,
  });

  const text = 'Breakthrough artificial intelligence research at DeepMind.';
  const entities = await detector.detectAsync(text);

  assert.strictEqual(entities.length, 1);
  assert.strictEqual(entities[0].type, 'ORGANIZATION');
  assert.strictEqual(entities[0].value, 'DeepMind');
});

test('LocalNerDetector handles unreachable offline server gracefully', async () => {
  const detector = new LocalNerDetector({
    providerType: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:59998/v1',
    timeoutMs: 150,
  });

  const available = await detector.isAvailable();
  assert.strictEqual(available, false);

  const entities = await detector.detectAsync('Contacter Alice au bureau.');
  assert.deepStrictEqual(entities, []);
});

test('MasterDetector combines regex matches with generic LocalNerDetector', async () => {
  const mockFetch = async (_url: string | URL | Request, _init?: RequestInit): Promise<Response> => {
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                entities: [{ type: 'PERSON', value: 'Nikola Tesla' }],
              }),
            },
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };

  const localDetector = new LocalNerDetector({
    providerType: 'openai-compatible',
    baseUrl: 'http://mock-lmstudio:1234/v1',
    fetchFn: mockFetch as any,
  });

  const master = new MasterDetector();
  master.setLocalDetector(localDetector);

  const text = 'Email: tesla@energy.org pour Nikola Tesla avec montant 15,000 $.';
  const entities = await master.detectAsync(text);

  // Email (regex), Person (local SLM), Amount (financial)
  assert.ok(entities.some(e => e.type === 'EMAIL' && e.value === 'tesla@energy.org'));
  assert.ok(entities.some(e => e.type === 'PERSON' && e.value === 'Nikola Tesla'));
  assert.ok(entities.some(e => e.type === 'AMOUNT' && e.value === '15,000 $'));
});

test('LocalNerDetector enforces strict word boundaries preventing sub-word entity corruption', async () => {
  const mockFetch = async () => {
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                entities: [{ type: 'PERSON', value: 'Dan' }],
              }),
            },
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };

  const detector = new LocalNerDetector({
    providerType: 'openai-compatible',
    baseUrl: 'http://localhost:1234/v1',
    fetchFn: mockFetch as any,
  });

  // "Dan" is inside "Daniel", "danger", and "Jordan", but only standalone "Dan" is a valid name
  const text = 'Daniel was in danger in Jordan with Dan at the embassy.';
  const entities = await detector.detectAsync(text);

  assert.strictEqual(entities.length, 1);
  assert.strictEqual(entities[0].value, 'Dan');
  assert.strictEqual(entities[0].start, 36);
});

test('LocalNerDetector handles Hugging Face nested batch arrays and merges adjacent B-PER/I-PER tokens', async () => {
  // Nested batch output [[ { ... } ]]
  const mockNestedFetch = async () => {
    return new Response(
      JSON.stringify([
        [
          { entity: 'B-PER', score: 0.99, word: 'Marie', start: 10, end: 15 },
          { entity: 'I-PER', score: 0.98, word: 'Curie', start: 16, end: 21 },
        ],
      ]),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };

  const detector = new LocalNerDetector({
    providerType: 'huggingface',
    baseUrl: 'http://localhost:8080',
    fetchFn: mockNestedFetch as any,
  });

  const text = 'Professor Marie Curie received the award.';
  const entities = await detector.detectAsync(text);

  // Both tokens should be merged into a single entity "Marie Curie"
  assert.strictEqual(entities.length, 1);
  assert.strictEqual(entities[0].type, 'PERSON');
  assert.strictEqual(entities[0].value, 'Marie Curie');
  assert.strictEqual(entities[0].start, 10);
  assert.strictEqual(entities[0].end, 21);
});

test('LocalNerDetector normalizes OpenAI-compatible base URLs without /v1 and handles direct JSON arrays', async () => {
  let calledUrl = '';
  const mockFetch = async (url: string | URL | Request) => {
    calledUrl = url.toString();
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              // Direct JSON array without wrapping {"entities": ...}
              content: '[{"type": "ORGANIZATION", "value": "Anthropic"}]',
            },
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };

  const detector = new LocalNerDetector({
    providerType: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:1234', // Missing /v1
    fetchFn: mockFetch as any,
  });

  const entities = await detector.detectAsync('Research paper published by Anthropic.');
  assert.strictEqual(calledUrl, 'http://127.0.0.1:1234/v1/chat/completions');
  assert.strictEqual(entities.length, 1);
  assert.strictEqual(entities[0].type, 'ORGANIZATION');
  assert.strictEqual(entities[0].value, 'Anthropic');
});

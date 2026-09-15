import test from 'node:test';
import assert from 'node:assert';
import { OllamaNerDetector } from '../src/detectors/ollama-detector.ts';
import { MasterDetector } from '../src/detectors/index.ts';

test('OllamaNerDetector handles offline Ollama daemon gracefully without throwing', async () => {
  // Point to an unavailable port to simulate offline daemon
  const detector = new OllamaNerDetector({
    baseUrl: 'http://127.0.0.1:59999',
    timeoutMs: 150,
  });

  const available = await detector.isAvailable();
  assert.strictEqual(available, false);

  const entities = await detector.detectAsync('Contacter Jean Valjean à Montreuil.');
  assert.deepStrictEqual(entities, []);
});

test('OllamaNerDetector parses JSON response and extracts entity spans correctly', async () => {
  const mockFetch = async (_url: string | URL | Request, _init?: RequestInit): Promise<Response> => {
    const mockOllamaBody = {
      response: JSON.stringify({
        entities: [
          { type: 'PERSON', value: 'Alexandre Dumas' },
          { type: 'ORGANIZATION', value: 'Éditions Gallimard' },
        ],
      }),
    };

    return new Response(JSON.stringify(mockOllamaBody), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const detector = new OllamaNerDetector({
    baseUrl: 'http://mock-ollama:11434',
    fetchFn: mockFetch as any,
  });

  const text = 'Manuscrit remis par Alexandre Dumas aux Éditions Gallimard.';
  const entities = await detector.detectAsync(text);

  assert.strictEqual(entities.length, 2);
  assert.strictEqual(entities[0].type, 'PERSON');
  assert.strictEqual(entities[0].value, 'Alexandre Dumas');
  assert.strictEqual(entities[1].type, 'ORGANIZATION');
  assert.strictEqual(entities[1].value, 'Éditions Gallimard');
});

test('MasterDetector combines fast regex matches with Ollama detectAsync', async () => {
  const mockFetch = async (_url: string | URL | Request, _init?: RequestInit): Promise<Response> => {
    return new Response(
      JSON.stringify({
        response: JSON.stringify({
          entities: [{ type: 'PERSON', value: 'Gérard de Nerval' }],
        }),
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };

  const ollama = new OllamaNerDetector({
    baseUrl: 'http://mock-ollama:11434',
    fetchFn: mockFetch as any,
  });

  const master = new MasterDetector({ enableOllama: true });
  master.setOllamaDetector(ollama);

  const text = 'Contact: gerard@example.com avec Gérard de Nerval.';
  const entities = await master.detectAsync(text);

  // Email detected by regex, Person detected by Ollama
  assert.ok(entities.some(e => e.type === 'EMAIL' && e.value === 'gerard@example.com'));
  assert.ok(entities.some(e => e.type === 'PERSON' && e.value === 'Gérard de Nerval'));
});

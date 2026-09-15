import test from 'node:test';
import assert from 'node:assert';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import type http from 'node:http';
import { CloakProxyServer } from '../src/proxy.ts';
import type { ChatCompletionRequest, CloakLLMConfig } from '../src/types.ts';

// Helper to create mock IncomingMessage
function createMockRequest(options: {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
}): http.IncomingMessage {
  const stream = new Readable({
    read() {
      if (options.body) {
        this.push(Buffer.from(options.body));
      }
      this.push(null);
    },
  });

  (stream as any).method = options.method;
  (stream as any).url = options.url;
  (stream as any).headers = options.headers || {};
  return stream as unknown as http.IncomingMessage;
}

// Helper to create mock ServerResponse
function createMockResponse(): http.ServerResponse & {
  getStatusCode: () => number;
  getBody: () => string;
  getHeaders: () => Record<string, string>;
} {
  const ee = new EventEmitter();
  let statusCode = 200;
  const headers: Record<string, string> = {};
  const chunks: Buffer[] = [];

  const res = Object.assign(ee, {
    statusCode,
    headersSent: false,
    setHeader(key: string, val: string) {
      headers[key.toLowerCase()] = val;
      return res;
    },
    getHeader(key: string) {
      return headers[key.toLowerCase()];
    },
    writeHead(code: number, hdrs?: Record<string, string>) {
      statusCode = code;
      res.headersSent = true;
      if (hdrs) {
        for (const [k, v] of Object.entries(hdrs)) {
          headers[k.toLowerCase()] = v;
        }
      }
      return res;
    },
    write(chunk: any) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      return true;
    },
    end(chunk?: any) {
      if (chunk) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      res.headersSent = true;
      ee.emit('finish');
      return res;
    },
    getStatusCode() {
      return statusCode;
    },
    getBody() {
      return Buffer.concat(chunks).toString('utf-8');
    },
    getHeaders() {
      return headers;
    },
  });

  return res as unknown as http.ServerResponse & {
    getStatusCode: () => number;
    getBody: () => string;
    getHeaders: () => Record<string, string>;
  };
}

test('CloakProxyServer E2E Integration: Healthcheck and Dashboard', async () => {
  const config: CloakLLMConfig = {
    port: 8080,
    host: '127.0.0.1',
    upstreamUrl: 'https://api.openai.com/v1',
    enabledDetectors: ['EMAIL', 'PHONE', 'IBAN', 'NIR', 'AMOUNT', 'SECRET', 'PERSON', 'ORGANIZATION'],
    enableDashboard: true,
    logLevel: 'silent',
  };

  const proxy = new CloakProxyServer(config);

  // 1. Healthcheck
  const reqHealth = createMockRequest({ method: 'GET', url: '/health' });
  const resHealth = createMockResponse();
  await proxy.handleRequest(reqHealth, resHealth);

  assert.strictEqual(resHealth.getStatusCode(), 200);
  const healthData = JSON.parse(resHealth.getBody());
  assert.strictEqual(healthData.status, 'ok');

  // 2. Dashboard
  const reqDash = createMockRequest({ method: 'GET', url: '/dashboard' });
  const resDash = createMockResponse();
  await proxy.handleRequest(reqDash, resDash);

  assert.strictEqual(resDash.getStatusCode(), 200);
  assert.ok(resDash.getBody().includes('CloakLLM'));

  // 3. API Sanitize preview
  const reqSanitize = createMockRequest({
    method: 'POST',
    url: '/api/sanitize',
    body: JSON.stringify({ text: 'Mon devis de 45 000 € pour M. Jean Dupont' }),
  });
  const resSanitize = createMockResponse();
  await proxy.handleRequest(reqSanitize, resSanitize);

  assert.strictEqual(resSanitize.getStatusCode(), 200);
  const sanitizeData = JSON.parse(resSanitize.getBody());
  assert.ok(sanitizeData.sanitized.includes('[PERSON_1]'));
  assert.ok(sanitizeData.sanitized.includes('[AMOUNT_1]'));
  assert.ok(sanitizeData.simulatedRestored.includes('Jean Dupont'));
  assert.ok(sanitizeData.simulatedRestored.includes('45 000 €'));
});

test('CloakProxyServer E2E Integration: Non-Streaming Chat Completions', async () => {
  let capturedUpstreamPayload: ChatCompletionRequest | null = null;

  // Mock upstream fetch implementation
  const mockFetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    capturedUpstreamPayload = JSON.parse(init?.body as string);

    // Simulate upstream reply containing the placeholders
    const replyBody = {
      id: 'chatcmpl-mock-123',
      object: 'chat.completion',
      created: 1700000000,
      model: 'gpt-4o',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: 'Validation confirmée pour [PERSON_1] pour le montant de [AMOUNT_1].',
          },
          finish_reason: 'stop',
        },
      ],
    };

    return new Response(JSON.stringify(replyBody), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const config: CloakLLMConfig = {
    port: 8080,
    host: '127.0.0.1',
    upstreamUrl: 'https://api.openai.com/v1',
    enabledDetectors: ['EMAIL', 'PHONE', 'IBAN', 'NIR', 'AMOUNT', 'SECRET', 'PERSON', 'ORGANIZATION'],
    enableDashboard: false,
    logLevel: 'silent',
    fetchFn: mockFetch as any,
  };

  const proxy = new CloakProxyServer(config);

  const reqChat = createMockRequest({
    method: 'POST',
    url: '/v1/chat/completions',
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: 'Confirmer le virement de 45 000 € pour M. Jean Dupont.',
        },
      ],
      stream: false,
    }),
  });
  const resChat = createMockResponse();

  await proxy.handleRequest(reqChat, resChat);

  assert.strictEqual(resChat.getStatusCode(), 200);

  // 1. Proof of Zero-Leak: Upstream never saw Jean Dupont or 45 000 €
  assert.ok(capturedUpstreamPayload);
  const upstreamText = (capturedUpstreamPayload as ChatCompletionRequest).messages[0].content as string;
  assert.strictEqual(upstreamText.includes('Jean Dupont'), false, 'Upstream leaked Jean Dupont!');
  assert.strictEqual(upstreamText.includes('45 000 €'), false, 'Upstream leaked 45 000 €!');
  assert.ok(upstreamText.includes('[PERSON_1]'));
  assert.ok(upstreamText.includes('[AMOUNT_1]'));

  // 2. Client received fully de-anonymized output
  const responseData = JSON.parse(resChat.getBody());
  const assistantReply = responseData.choices[0].message.content;
  assert.strictEqual(
    assistantReply,
    'Validation confirmée pour Jean Dupont pour le montant de 45 000 €.'
  );
});

test('CloakProxyServer E2E Integration: Streaming SSE with Chunk-Split Placeholders', async () => {
  let capturedUpstreamPayload: ChatCompletionRequest | null = null;

  // Mock upstream streaming response
  const mockFetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    capturedUpstreamPayload = JSON.parse(init?.body as string);

    // ReadableStream emitting SSE chunks where "[PERSON_1]" is split across 2 chunks:
    // Chunk 1: "Accord donné à [PER"
    // Chunk 2: "SON_1] avec succès."
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        const c1 = {
          id: 'chunk-1',
          object: 'chat.completion.chunk',
          created: 1700000000,
          model: 'gpt-4o',
          choices: [{ index: 0, delta: { content: 'Accord donné à [PER' }, finish_reason: null }],
        };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(c1)}\n\n`));

        const c2 = {
          id: 'chunk-2',
          object: 'chat.completion.chunk',
          created: 1700000000,
          model: 'gpt-4o',
          choices: [{ index: 0, delta: { content: 'SON_1] avec succès.' }, finish_reason: null }],
        };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(c2)}\n\n`));

        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });

    return new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  };

  const config: CloakLLMConfig = {
    port: 8080,
    host: '127.0.0.1',
    upstreamUrl: 'https://api.openai.com/v1',
    enabledDetectors: ['EMAIL', 'PHONE', 'IBAN', 'NIR', 'AMOUNT', 'SECRET', 'PERSON', 'ORGANIZATION'],
    enableDashboard: false,
    logLevel: 'silent',
    fetchFn: mockFetch as any,
  };

  const proxy = new CloakProxyServer(config);

  const reqStream = createMockRequest({
    method: 'POST',
    url: '/v1/chat/completions',
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: 'Transmettre le dossier de M. Jean Dupont.',
        },
      ],
      stream: true,
    }),
  });
  const resStream = createMockResponse();

  await proxy.handleRequest(reqStream, resStream);

  assert.strictEqual(resStream.getStatusCode(), 200);
  assert.ok(resStream.getHeaders()['content-type']?.includes('text/event-stream'));

  const sseBody = resStream.getBody();
  assert.ok(sseBody.includes('data:'));

  // Parse chunks and reassemble content
  const lines = sseBody.split('\n');
  let reconstructedStream = '';
  for (const line of lines) {
    if (line.startsWith('data: ') && !line.includes('[DONE]')) {
      const parsed = JSON.parse(line.substring(6));
      if (parsed.choices?.[0]?.delta?.content) {
        reconstructedStream += parsed.choices[0].delta.content;
      }
    }
  }

  // Verification: Stream correctly buffered and stitched the split placeholder
  assert.strictEqual(
    reconstructedStream,
    'Accord donné à Jean Dupont avec succès.'
  );
});

test('CloakProxyServer handles malformed JSON with 400 Bad Request', async () => {
  const config: CloakLLMConfig = {
    port: 8080,
    host: '127.0.0.1',
    upstreamUrl: 'https://api.openai.com/v1',
    enabledDetectors: ['EMAIL'],
    enableDashboard: false,
    logLevel: 'silent',
  };

  const proxy = new CloakProxyServer(config);

  const req = createMockRequest({
    method: 'POST',
    url: '/v1/chat/completions',
    body: 'this-is-not-json',
  });
  const res = createMockResponse();

  await proxy.handleRequest(req, res);

  assert.strictEqual(res.getStatusCode(), 400);
  const body = JSON.parse(res.getBody());
  assert.ok(body.error);
});

test('CloakProxyServer rejects non-array messages with 400 Bad Request', async () => {
  const config: CloakLLMConfig = {
    port: 8080,
    host: '127.0.0.1',
    upstreamUrl: 'https://api.openai.com/v1',
    enabledDetectors: ['EMAIL'],
    enableDashboard: false,
    logLevel: 'silent',
  };

  const proxy = new CloakProxyServer(config);

  const req = createMockRequest({
    method: 'POST',
    url: '/v1/chat/completions',
    body: JSON.stringify({ model: 'gpt-4o', messages: 'not-an-array' }),
  });
  const res = createMockResponse();

  await proxy.handleRequest(req, res);

  assert.strictEqual(res.getStatusCode(), 400);
  const body = JSON.parse(res.getBody());
  assert.ok(body.error?.message?.includes('messages must be an array'));
});

test('CloakProxyServer preserves SessionVault across requests with X-Session-ID header', async () => {
  let capturedPayload1: ChatCompletionRequest | null = null;
  let capturedPayload2: ChatCompletionRequest | null = null;

  const mockFetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const payload = JSON.parse(init?.body as string);
    if (!capturedPayload1) {
      capturedPayload1 = payload;
    } else {
      capturedPayload2 = payload;
    }

    return new Response(
      JSON.stringify({
        id: 'chatcmpl-test',
        choices: [{ index: 0, message: { role: 'assistant', content: 'OK' } }],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };

  const config: CloakLLMConfig = {
    port: 8080,
    host: '127.0.0.1',
    upstreamUrl: 'https://api.openai.com/v1',
    enabledDetectors: ['PERSON'],
    enableDashboard: false,
    logLevel: 'silent',
    fetchFn: mockFetch as any,
  };

  const proxy = new CloakProxyServer(config);
  const sessionId = 'session_test_abc123';

  // Request 1: Introduce M. Thomas Bernard
  const req1 = createMockRequest({
    method: 'POST',
    url: '/v1/chat/completions',
    headers: { 'x-session-id': sessionId },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Voici M. Thomas Bernard.' }],
    }),
  });
  const res1 = createMockResponse();
  await proxy.handleRequest(req1, res1);

  assert.strictEqual(res1.getStatusCode(), 200);
  assert.ok((capturedPayload1 as any).messages[0].content.includes('[PERSON_1]'));

  // Request 2: Use the same session, referencing Thomas Bernard without "M."
  const req2 = createMockRequest({
    method: 'POST',
    url: '/v1/chat/completions',
    headers: { 'x-session-id': sessionId },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Est-ce que Thomas Bernard a confirmé ?' }],
    }),
  });
  const res2 = createMockResponse();
  await proxy.handleRequest(req2, res2);

  assert.strictEqual(res2.getStatusCode(), 200);
  const req2UpstreamContent = (capturedPayload2 as any).messages[0].content;
  // Crucial check: Thomas Bernard was sanitized to [PERSON_1] across requests!
  assert.strictEqual(req2UpstreamContent.includes('Thomas Bernard'), false, 'Leaked Thomas Bernard in session turn 2!');
  assert.ok(req2UpstreamContent.includes('[PERSON_1]'));
});

test('CloakProxyServer de-anonymizes tool_calls arguments in assistant choice', async () => {
  const mockFetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-tool',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_abc',
                  type: 'function',
                  function: {
                    name: 'process_payment',
                    arguments: JSON.stringify({ client: '[PERSON_1]', amount: '[AMOUNT_1]' }),
                  },
                },
              ],
            },
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };

  const config: CloakLLMConfig = {
    port: 8080,
    host: '127.0.0.1',
    upstreamUrl: 'https://api.openai.com/v1',
    enabledDetectors: ['PERSON', 'AMOUNT'],
    enableDashboard: false,
    logLevel: 'silent',
    fetchFn: mockFetch as any,
  };

  const proxy = new CloakProxyServer(config);

  const req = createMockRequest({
    method: 'POST',
    url: '/v1/chat/completions',
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Paiement de 5 000 € pour M. Thomas Bernard.' }],
    }),
  });
  const res = createMockResponse();
  await proxy.handleRequest(req, res);

  assert.strictEqual(res.getStatusCode(), 200);
  const body = JSON.parse(res.getBody());
  const toolCall = body.choices[0].message.tool_calls[0];
  const args = JSON.parse(toolCall.function.arguments);

  assert.strictEqual(args.client, 'Thomas Bernard');
  assert.strictEqual(args.amount, '5 000 €');
});

test('CloakProxyServer renders bilingual dashboard HTML with language switch controls', async () => {
  const config: CloakLLMConfig = {
    port: 8080,
    host: '127.0.0.1',
    upstreamUrl: 'https://api.openai.com/v1',
    enabledDetectors: ['EMAIL', 'PERSON'],
    enableDashboard: true,
    logLevel: 'silent',
  };

  const proxy = new CloakProxyServer(config);
  const req = createMockRequest({ method: 'GET', url: '/dashboard' });
  const res = createMockResponse();

  await proxy.handleRequest(req, res);

  assert.strictEqual(res.getStatusCode(), 200);
  assert.ok(res.getHeaders()['content-type']?.includes('text/html'));
  const html = res.getBody();

  // Must contain language switch elements
  assert.ok(html.includes('lang-switcher'));
  assert.ok(html.includes('btn-fr'));
  assert.ok(html.includes('btn-en'));
  assert.ok(html.includes('setLanguage'));
  assert.ok(html.includes('tag-SSN'));
  assert.ok(html.includes('tag-NINO'));
  assert.ok(html.includes('t-no-analysis'));
  assert.ok(html.includes('translations = {'));
});

test('CloakProxyServer /api/sanitize endpoint detects US and UK PII and returns simulated restoration', async () => {
  const config: CloakLLMConfig = {
    port: 8080,
    host: '127.0.0.1',
    upstreamUrl: 'https://api.openai.com/v1',
    enabledDetectors: ['SSN', 'NINO', 'PERSON', 'ORGANIZATION', 'PHONE', 'EMAIL'],
    enableDashboard: true,
    logLevel: 'silent',
  };

  const proxy = new CloakProxyServer(config);
  const prompt = 'Contact Mr. John Smith (SSN: 123-45-6789, NINO: QQ 12 34 56 A) at Acme Corp.';

  const req = createMockRequest({
    method: 'POST',
    url: '/api/sanitize',
    body: JSON.stringify({ text: prompt }),
  });
  const res = createMockResponse();

  await proxy.handleRequest(req, res);

  assert.strictEqual(res.getStatusCode(), 200);
  const data = JSON.parse(res.getBody());

  assert.ok(data.sanitized.includes('[PERSON_1]'));
  assert.ok(data.sanitized.includes('[SSN_1]'));
  assert.ok(data.sanitized.includes('[NINO_1]'));
  assert.ok(data.sanitized.includes('[ORGANIZATION_1]'));
  assert.strictEqual(data.simulatedRestored, prompt);
});



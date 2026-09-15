import test from 'node:test';
import assert from 'node:assert';
import { CostGuard, estimateTokens } from '../src/cost-guard.ts';

test('estimateTokens calculates fast character and word-based token heuristic', () => {
  assert.strictEqual(estimateTokens(''), 0);
  // "Hello world" -> 11 chars -> ~3 tokens
  const est = estimateTokens('Hello world');
  assert.ok(est >= 2 && est <= 4);

  const code = 'function add(a: number, b: number): number { return a + b; }';
  const codeEst = estimateTokens(code);
  assert.ok(codeEst >= 10 && codeEst <= 25);
});

test('CostGuard enforces sliding window rate limit', () => {
  const guard = new CostGuard({ maxRequestsPerMinute: 3 });
  const client = 'client-1';
  const now = 1000000;

  // Requests 1, 2, 3 permitted
  assert.strictEqual(guard.checkRequest(client, 'prompt 1', now).allowed, true);
  assert.strictEqual(guard.checkRequest(client, 'prompt 2', now + 1000).allowed, true);
  assert.strictEqual(guard.checkRequest(client, 'prompt 3', now + 2000).allowed, true);

  // Request 4 blocked by rate limit
  const res4 = guard.checkRequest(client, 'prompt 4', now + 3000);
  assert.strictEqual(res4.allowed, false);
  assert.ok(res4.reason?.includes('Rate limit exceeded'));
  assert.ok((res4.retryAfterSeconds || 0) > 0);

  // Request at now + 61000 permitted as oldest request expired
  assert.strictEqual(guard.checkRequest(client, 'prompt 5', now + 61000).allowed, true);
});

test('CostGuard agentic loop circuit breaker trips on repetitive identical requests', () => {
  const guard = new CostGuard({
    maxRequestsPerMinute: 100,
    maxIdenticalPrompts: 3,
    circuitCooldownMs: 10000,
  });
  const client = 'agent-loop-test';
  const now = 5000000;

  // Submit identical prompts 1 and 2
  assert.strictEqual(guard.checkRequest(client, 'loop prompt', now).allowed, true);
  assert.strictEqual(guard.checkRequest(client, 'loop prompt', now + 100).allowed, true);

  // Third identical prompt trips circuit breaker!
  const res3 = guard.checkRequest(client, 'loop prompt', now + 200);
  assert.strictEqual(res3.allowed, false);
  assert.strictEqual(res3.circuitState, 'OPEN');
  assert.ok(res3.reason?.includes('Runaway agentic loop'));

  // Further requests during cooldown are blocked immediately
  const res4 = guard.checkRequest(client, 'different prompt', now + 500);
  assert.strictEqual(res4.allowed, false);
  assert.strictEqual(res4.circuitState, 'OPEN');

  // After cooldown (10s), enters HALF_OPEN and permits probe request
  const res5 = guard.checkRequest(client, 'new legitimate task', now + 11000);
  assert.strictEqual(res5.allowed, true);

  // If subsequent call succeeds, state resets to CLOSED
  const res6 = guard.checkRequest(client, 'another legitimate task', now + 12000);
  assert.strictEqual(res6.allowed, true);
  assert.strictEqual(res6.circuitState, 'CLOSED');
});

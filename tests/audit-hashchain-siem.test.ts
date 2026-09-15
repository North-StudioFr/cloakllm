import test from 'node:test';
import assert from 'node:assert';
import { AuditLogger, computeRecordHash, GENESIS_HASH, verifyAuditLogIntegrity } from '../src/logger.ts';
import { formatRfc5424Syslog, SiemExporter } from '../src/siem-exporter.ts';
import type { AuditRecord } from '../src/types.ts';

test('AuditLogger builds valid cryptographic SHA-256 hash-chain', () => {
  const logger = new AuditLogger('silent');

  const rec1: AuditRecord = {
    requestId: 'req-1',
    timestamp: '2026-09-15T12:00:00Z',
    model: 'gpt-4o',
    entitiesDetected: 1,
    entityBreakdown: { PERSON: 1 },
    processingLatencyMs: 2,
    upstreamLatencyMs: 150,
    isStreaming: false,
    status: 'SUCCESS',
  };

  const rec2: AuditRecord = {
    requestId: 'req-2',
    timestamp: '2026-09-15T12:00:01Z',
    model: 'gpt-4o',
    entitiesDetected: 2,
    entityBreakdown: { EMAIL: 2 },
    processingLatencyMs: 3,
    upstreamLatencyMs: 200,
    isStreaming: true,
    status: 'SUCCESS',
  };

  logger.record(rec1);
  logger.record(rec2);

  const logs = logger.getRecentLogs();
  assert.strictEqual(logs.length, 2);

  // rec1 is genesis link
  assert.strictEqual(rec1.previousHash, GENESIS_HASH);
  assert.ok(rec1.hash);

  // rec2 links to rec1
  assert.strictEqual(rec2.previousHash, rec1.hash);
  assert.ok(rec2.hash);

  // Verification passes
  const verification = logger.verifyIntegrity();
  assert.strictEqual(verification.valid, true);
});

test('verifyAuditLogIntegrity detects tampering in historical records', () => {
  const records: AuditRecord[] = [];
  let prev = GENESIS_HASH;

  for (let i = 0; i < 3; i++) {
    const rec: AuditRecord = {
      requestId: `req-${i}`,
      timestamp: `2026-09-15T12:00:0${i}Z`,
      model: 'gpt-4o',
      entitiesDetected: i,
      entityBreakdown: {},
      processingLatencyMs: 1,
      upstreamLatencyMs: 10,
      isStreaming: false,
      status: 'SUCCESS',
      previousHash: prev,
    };
    rec.hash = computeRecordHash(prev, rec);
    prev = rec.hash;
    records.push(rec);
  }

  // Chain valid before tampering
  assert.strictEqual(verifyAuditLogIntegrity(records).valid, true);

  // Maliciously modify record 1 payload
  records[1].entitiesDetected = 999;

  // Verification must FAIL!
  const failedVerification = verifyAuditLogIntegrity(records);
  assert.strictEqual(failedVerification.valid, false);
  assert.strictEqual(failedVerification.brokenAtIndex, 1);
  assert.ok(failedVerification.error?.includes('Tampered hash'));
});

test('formatRfc5424Syslog generates valid standard syslog message', () => {
  const rec: AuditRecord = {
    requestId: 'req-987',
    timestamp: '2026-09-15T12:00:00.000Z',
    model: 'claude-3-5-sonnet',
    entitiesDetected: 3,
    entityBreakdown: { SECRET: 1, IBAN: 2 },
    processingLatencyMs: 4,
    upstreamLatencyMs: 350,
    isStreaming: false,
    status: 'SUCCESS',
    hash: 'a1b2c3d4e5f6',
    previousHash: '000000000000',
  };

  const syslog = formatRfc5424Syslog(rec, 'CloakLLM');
  assert.ok(syslog.startsWith('<14>1')); // User facility, info priority
  assert.ok(syslog.includes('CloakLLM'));
  assert.ok(syslog.includes('req-987'));
  assert.ok(syslog.includes('[cloakllm@32473'));
  assert.ok(syslog.includes('model="claude-3-5-sonnet"'));
  assert.ok(syslog.includes('entities="3"'));
  assert.ok(syslog.includes('hash="a1b2c3d4e5f6"'));
});

test('SiemExporter pushes records to webhook', async () => {
  let capturedPayload: any = null;
  const mockFetch = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    capturedPayload = JSON.parse(init?.body as string);
    return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
  };

  const exporter = new SiemExporter(
    { webhookUrl: 'https://siem.corp.internal/v1/events', apiKey: 'test-key' },
    mockFetch as any
  );

  const rec: AuditRecord = {
    requestId: 'req-siem-1',
    timestamp: new Date().toISOString(),
    model: 'gpt-4o',
    entitiesDetected: 1,
    entityBreakdown: { NIR: 1 },
    processingLatencyMs: 1,
    upstreamLatencyMs: 50,
    isStreaming: false,
    status: 'SUCCESS',
  };

  const success = await exporter.exportRecord(rec);
  assert.strictEqual(success, true);
  assert.ok(capturedPayload);
  assert.strictEqual(capturedPayload.source, 'cloakllm');
  assert.strictEqual(capturedPayload.event.requestId, 'req-siem-1');
  assert.ok(capturedPayload.syslog.includes('req-siem-1'));
});

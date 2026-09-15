/**
 * Tests for CloakLLM DPO Compliance Audit & Reporting Engine (GDPR Article 32 / CNIL)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import {
  AuditLogger,
  ComplianceEngine,
  CloakProxyServer,
  type AuditRecord,
} from '../src/index.ts';

function createMockRequest(options: {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
}) {
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
  return stream;
}

function createMockResponse() {
  const ee = new EventEmitter();
  let statusCode = 200;
  const headers: Record<string, string> = {};
  const chunks: Buffer[] = [];

  return Object.assign(ee, {
    statusCode,
    headersSent: false,
    setHeader(k: string, v: string) {
      headers[k.toLowerCase()] = v;
      return this;
    },
    getHeader(k: string) {
      return headers[k.toLowerCase()];
    },
    writeHead(c: number, hdrs?: Record<string, string>) {
      statusCode = c;
      this.headersSent = true;
      if (hdrs) {
        for (const [k, v] of Object.entries(hdrs)) {
          headers[k.toLowerCase()] = v;
        }
      }
      return this;
    },
    write(chunk: any) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      return true;
    },
    end(chunk?: any) {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      this.headersSent = true;
      ee.emit('finish');
      return this;
    },
    getStatusCode() { return statusCode; },
    getBody() { return Buffer.concat(chunks).toString('utf-8'); },
    getHeaders() { return headers; },
  });
}

test('ComplianceEngine aggregates zero-knowledge metrics accurately', () => {
  const logger = new AuditLogger('silent');
  const engine = new ComplianceEngine(logger);

  // Initial empty summary
  const emptySummary = engine.getSummary();
  assert.equal(emptySummary.totalRequests, 0);
  assert.equal(emptySummary.totalEntitiesProtected, 0);
  assert.equal(emptySummary.riskReductionPercentage, 100);
  assert.equal(emptySummary.gdprComplianceStatus, 'CERTIFIED_ARTICLE_32');

  // Record simulated requests
  const record1: AuditRecord = {
    requestId: 'req_1',
    timestamp: new Date().toISOString(),
    model: 'gpt-4o',
    entitiesDetected: 3,
    entityBreakdown: { NIR: 1, IBAN: 1, PERSON: 1 },
    processingLatencyMs: 1.4,
    upstreamLatencyMs: 250,
    isStreaming: false,
    status: 'SUCCESS',
  };

  const record2: AuditRecord = {
    requestId: 'req_2',
    timestamp: new Date().toISOString(),
    model: 'claude-3-5-sonnet',
    entitiesDetected: 2,
    entityBreakdown: { SSN: 1, SECRET: 1 },
    processingLatencyMs: 1.8,
    upstreamLatencyMs: 310,
    isStreaming: true,
    status: 'SUCCESS',
  };

  logger.record(record1);
  logger.record(record2);

  const summary = engine.getSummary();
  assert.equal(summary.totalRequests, 2);
  assert.equal(summary.totalEntitiesProtected, 5);
  assert.equal(summary.riskReductionPercentage, 100);
  assert.equal(summary.categoryBreakdown['NIR'], 1);
  assert.equal(summary.categoryBreakdown['IBAN'], 1);
  assert.equal(summary.categoryBreakdown['SECRET'], 1);
  assert.equal(summary.categoryBreakdown['SSN'], 1);
  assert.equal(summary.upstreamDestinations['gpt-4o'], 1);
  assert.equal(summary.upstreamDestinations['claude-3-5-sonnet'], 1);
  assert.ok(summary.averageLatencyMs.sanitization > 0);
});

test('ComplianceEngine generates valid JSON report with Article 32 legal notice', () => {
  const logger = new AuditLogger('silent');
  const engine = new ComplianceEngine(logger);

  logger.record({
    requestId: 'req_test',
    timestamp: new Date().toISOString(),
    model: 'gpt-4o-mini',
    entitiesDetected: 1,
    entityBreakdown: { CREDIT_CARD: 1 },
    processingLatencyMs: 0.8,
    upstreamLatencyMs: 120,
    isStreaming: false,
    status: 'SUCCESS',
  });

  const report = engine.generateJsonReport();
  assert.ok(report.generatedAt);
  assert.equal(report.summary.totalRequests, 1);
  assert.equal(report.summary.totalEntitiesProtected, 1);
  assert.ok(report.legalNotice.includes('GDPR Article 32'));
  assert.equal(report.recentAuditRecords.length, 1);
});

test('ComplianceEngine generates Markdown report with CNIL & GDPR references', () => {
  const logger = new AuditLogger('silent');
  const engine = new ComplianceEngine(logger);

  logger.record({
    requestId: 'req_md',
    timestamp: new Date().toISOString(),
    model: 'gpt-4o',
    entitiesDetected: 4,
    entityBreakdown: { NIR: 2, EMAIL: 2 },
    processingLatencyMs: 1.2,
    upstreamLatencyMs: 180,
    isStreaming: false,
    status: 'SUCCESS',
  });

  const md = engine.generateMarkdownReport();
  assert.ok(md.includes('# 🛡️ CloakLLM DPO Compliance & GDPR Audit Report'));
  assert.ok(md.includes('GDPR (EU 2016/679) Articles 25 & 32'));
  assert.ok(md.includes('CNIL AI Governance Standards'));
  assert.ok(md.includes('NIR'));
  assert.ok(md.includes('EMAIL'));
  assert.ok(md.includes('In-Memory RAM Only'));
});

test('ComplianceEngine generates self-contained printable HTML report with print styles', () => {
  const logger = new AuditLogger('silent');
  const engine = new ComplianceEngine(logger);

  const html = engine.generateHtmlReport();
  assert.ok(html.includes('<!DOCTYPE html>'));
  assert.ok(html.includes('CloakLLM - DPO Compliance & GDPR Article 32 Audit Report'));
  assert.ok(html.includes('@media print'));
  assert.ok(html.includes('CERTIFIED_ARTICLE_32'));
  assert.ok(html.includes('Print / Save PDF'));
});

test('CloakProxyServer exposes /api/compliance/report and /api/compliance/summary', async () => {
  const proxy = new CloakProxyServer({
    port: 8080,
    host: '127.0.0.1',
    upstreamUrl: 'https://api.openai.com/v1',
    enabledDetectors: ['EMAIL', 'PHONE', 'NIR'],
    enableDashboard: false,
    logLevel: 'silent',
  });

  // Seed with an audit event
  proxy.getLogger().record({
    requestId: 'req_api_test',
    timestamp: new Date().toISOString(),
    model: 'gpt-4o',
    entitiesDetected: 2,
    entityBreakdown: { NIR: 1, EMAIL: 1 },
    processingLatencyMs: 1.1,
    upstreamLatencyMs: 145,
    isStreaming: false,
    status: 'SUCCESS',
  });

  // 1. GET /api/compliance/report (JSON format default)
  const reqJson = createMockRequest({ method: 'GET', url: '/api/compliance/report' });
  const resJson = createMockResponse();
  await proxy.handleRequest(reqJson as any, resJson as any);
  assert.equal(resJson.getStatusCode(), 200);
  const jsonData = JSON.parse(resJson.getBody());
  assert.equal(jsonData.summary.totalRequests, 1);
  assert.equal(jsonData.summary.totalEntitiesProtected, 2);

  // 2. GET /api/compliance/report?format=html
  const reqHtml = createMockRequest({ method: 'GET', url: '/api/compliance/report?format=html' });
  const resHtml = createMockResponse();
  await proxy.handleRequest(reqHtml as any, resHtml as any);
  assert.equal(resHtml.getStatusCode(), 200);
  assert.ok(resHtml.getHeaders()['content-type'].includes('text/html'));
  assert.ok(resHtml.getBody().includes('<!DOCTYPE html>'));

  // 3. GET /api/compliance/report?format=markdown
  const reqMd = createMockRequest({ method: 'GET', url: '/api/compliance/report?format=markdown' });
  const resMd = createMockResponse();
  await proxy.handleRequest(reqMd as any, resMd as any);
  assert.equal(resMd.getStatusCode(), 200);
  assert.ok(resMd.getHeaders()['content-type'].includes('text/markdown'));
  assert.ok(resMd.getBody().includes('# 🛡️ CloakLLM DPO Compliance'));

  // 4. GET /api/compliance/summary
  const reqSummary = createMockRequest({ method: 'GET', url: '/api/compliance/summary' });
  const resSummary = createMockResponse();
  await proxy.handleRequest(reqSummary as any, resSummary as any);
  assert.equal(resSummary.getStatusCode(), 200);
  const summaryData = JSON.parse(resSummary.getBody());
  assert.equal(summaryData.totalRequests, 1);
  assert.equal(summaryData.totalEntitiesProtected, 2);
});

test('AuditLogger with persistent logFile appends zero-knowledge records and reloads', () => {
  const tmpLogFile = path.join(os.tmpdir(), `cloakllm-audit-${Date.now()}.jsonl`);

  try {
    const logger = new AuditLogger('silent', tmpLogFile);
    logger.record({
      requestId: 'req_file_1',
      timestamp: new Date().toISOString(),
      model: 'gpt-4o',
      entitiesDetected: 1,
      entityBreakdown: { PHONE: 1 },
      processingLatencyMs: 0.5,
      upstreamLatencyMs: 100,
      isStreaming: false,
      status: 'SUCCESS',
    });

    assert.ok(fs.existsSync(tmpLogFile));
    const content = fs.readFileSync(tmpLogFile, 'utf-8');
    assert.ok(content.includes('req_file_1'));
    assert.ok(content.includes('PHONE'));

    // New logger instance reloads recent entries from file
    const logger2 = new AuditLogger('silent', tmpLogFile);
    const reloaded = logger2.getRecentLogs();
    assert.equal(reloaded.length, 1);
    assert.equal(reloaded[0].requestId, 'req_file_1');
  } finally {
    if (fs.existsSync(tmpLogFile)) fs.unlinkSync(tmpLogFile);
  }
});

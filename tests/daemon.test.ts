/**
 * Tests for CloakLLM CLI Daemon & Process Management
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {
  getDaemonPaths,
  isProcessRunning,
  writePidFile,
  readPidFile,
  removePidFile,
  getDaemonStatus,
  pingHealth,
  exportAuditReport,
} from '../src/daemon.ts';

test('getDaemonPaths returns accessible directory and file paths', () => {
  const paths = getDaemonPaths();
  assert.ok(paths.dir);
  assert.ok(paths.pidFile.endsWith('cloakllm.pid'));
  assert.ok(paths.logFile.endsWith('cloakllm.log'));
  assert.ok(fs.existsSync(paths.dir));
});

test('isProcessRunning detects current process and rejects invalid pid', () => {
  assert.equal(isProcessRunning(process.pid), true);
  // Negative or extreme PID should not be running
  assert.equal(isProcessRunning(9999999), false);
});

test('writePidFile, readPidFile, and removePidFile handle PID lifecycle and state metadata', () => {
  const testPid = 888888;
  writePidFile(testPid, { port: 9090, host: '0.0.0.0' });
  assert.equal(readPidFile(), testPid);

  // Test backward compatibility when file contains bare integer
  const { pidFile } = getDaemonPaths();
  fs.writeFileSync(pidFile, '123456\n', 'utf-8');
  assert.equal(readPidFile(), 123456);

  removePidFile();
  assert.equal(readPidFile(), null);
});

test('getDaemonStatus reports STOPPED when not running', async () => {
  removePidFile();
  const status = await getDaemonStatus('127.0.0.1', 8080);
  assert.equal(status.isRunning, false);
  assert.equal(status.pid, null);
});

test('pingHealth returns health payload from reachable server', async () => {
  const mockFetch = async (url: string | URL | Request) => {
    if (url.toString().includes('/health')) {
      return new Response(JSON.stringify({ status: 'ok', version: '2.0.0', uptime: 42 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(null, { status: 404 });
  };

  const health = await pingHealth('127.0.0.1', 8080, mockFetch as any);
  assert.ok(health);
  assert.equal(health?.status, 'ok');
  assert.equal(health?.version, '2.0.0');

  // Test unreachable / failure case
  const failingFetch = async () => {
    throw new Error('Connection refused');
  };
  const unreachable = await pingHealth('127.0.0.1', 59999, failingFetch as any);
  assert.equal(unreachable, null);
});

test('exportAuditReport exports report from running server to file with custom port resolution', async () => {
  let requestedUrl = '';
  const mockFetch = async (url: string | URL | Request) => {
    requestedUrl = url.toString();
    if (requestedUrl.includes('/api/compliance/report')) {
      return new Response(JSON.stringify({ status: 'certified', totalRequests: 10 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(null, { status: 404 });
  };

  // 1. Explicit port/host
  const tmpOut = path.join(os.tmpdir(), `cloakllm-export-${Date.now()}.json`);

  try {
    const data = await exportAuditReport('json', tmpOut, '127.0.0.1', 9000, mockFetch as any);
    assert.ok(fs.existsSync(tmpOut));
    const content = fs.readFileSync(tmpOut, 'utf-8');
    assert.ok(content.includes('certified'));
    assert.ok(data.includes('certified'));
    assert.ok(requestedUrl.includes(':9000/api/compliance/report'));
  } finally {
    if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut);
  }

  // 2. Fallback to state file port when default (8080) is passed
  writePidFile(process.pid, { port: 9123, host: '127.0.0.1' });
  try {
    await exportAuditReport('html', undefined, '127.0.0.1', 8080, mockFetch as any);
    assert.ok(requestedUrl.includes(':9123/api/compliance/report?format=html'));
  } finally {
    removePidFile();
  }
});

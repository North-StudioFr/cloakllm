/**
 * CloakLLM Structured Zero-Knowledge Audit Logger & Cryptographic Hash-Chain
 * Records sanitization metrics without persisting or printing raw sensitive values.
 * Secures every record with a SHA-256 hash linked to the preceding entry (tamper-evident audit).
 * Supports direct asynchronous SIEM export (Splunk, Elastic, Sentinel, Syslog).
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { AuditRecord } from './types.ts';
import { SiemExporter } from './siem-exporter.ts';

export const GENESIS_HASH = '0'.repeat(64);

/**
 * Computes SHA-256 seal for an audit record linked to its predecessor.
 */
export function computeRecordHash(previousHash: string, record: AuditRecord): string {
  const sortedBreakdown: Record<string, number> = {};
  if (record.entityBreakdown) {
    for (const key of Object.keys(record.entityBreakdown).sort()) {
      sortedBreakdown[key] = record.entityBreakdown[key];
    }
  }

  const payload = {
    requestId: record.requestId,
    timestamp: record.timestamp,
    model: record.model,
    entitiesDetected: record.entitiesDetected,
    entityBreakdown: sortedBreakdown,
    processingLatencyMs: record.processingLatencyMs,
    upstreamLatencyMs: record.upstreamLatencyMs,
    isStreaming: record.isStreaming,
    status: record.status,
    policyAction: record.policyAction,
    riskScore: record.riskScore,
    previousHash,
  };
  return crypto.createHash('sha256').update(previousHash + JSON.stringify(payload)).digest('hex');
}

/**
 * Verifies the integrity of a sequence of audit records (ordered chronologically oldest to newest).
 */
export function verifyAuditLogIntegrity(recordsChronological: AuditRecord[]): {
  valid: boolean;
  brokenAtIndex?: number;
  error?: string;
} {
  let expectedPrev = GENESIS_HASH;

  for (let i = 0; i < recordsChronological.length; i++) {
    const rec = recordsChronological[i];
    if (!rec.hash || !rec.previousHash) {
      // Unhashed legacy record
      continue;
    }

    if (rec.previousHash !== expectedPrev) {
      return {
        valid: false,
        brokenAtIndex: i,
        error: `Broken link at index ${i}: expected previousHash ${expectedPrev}, found ${rec.previousHash}`,
      };
    }

    const recomputed = computeRecordHash(rec.previousHash, rec);
    if (recomputed !== rec.hash) {
      return {
        valid: false,
        brokenAtIndex: i,
        error: `Tampered hash at index ${i}: expected ${recomputed}, found ${rec.hash}`,
      };
    }

    expectedPrev = rec.hash;
  }

  return { valid: true };
}

export class AuditLogger {
  private inMemoryAuditLog: AuditRecord[] = []; // newest first (index 0)
  private maxHistory: number = 500;
  private logLevel: 'silent' | 'info' | 'debug';
  private logFile?: string;
  private lastRecordedHash: string = GENESIS_HASH;
  private siemExporter?: SiemExporter;

  constructor(
    logLevel: 'silent' | 'info' | 'debug' = 'info',
    logFile?: string,
    siemExporter?: SiemExporter
  ) {
    this.logLevel = logLevel;
    this.logFile = logFile;
    this.siemExporter = siemExporter;

    if (this.logFile && fs.existsSync(this.logFile)) {
      try {
        const lines = fs.readFileSync(this.logFile, 'utf-8').trim().split('\n').filter(Boolean);
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line) as AuditRecord;
            if (parsed.hash) {
              this.lastRecordedHash = parsed.hash;
            }
            this.inMemoryAuditLog.unshift(parsed);
          } catch {
            // ignore corrupt lines
          }
        }
        if (this.inMemoryAuditLog.length > this.maxHistory) {
          this.inMemoryAuditLog = this.inMemoryAuditLog.slice(0, this.maxHistory);
        }
      } catch {
        // ignore read errors
      }
    }
  }

  public setSiemExporter(exporter: SiemExporter): void {
    this.siemExporter = exporter;
  }

  public record(audit: AuditRecord): void {
    // 1. Seal record with SHA-256 Hash Chain
    if (!audit.hash) {
      const prevHash = this.lastRecordedHash;
      audit.previousHash = prevHash;
      audit.hash = computeRecordHash(prevHash, audit);
      this.lastRecordedHash = audit.hash;
    }

    // 2. Store in memory
    this.inMemoryAuditLog.unshift(audit);
    if (this.inMemoryAuditLog.length > this.maxHistory) {
      this.inMemoryAuditLog.pop();
    }

    // 3. Append to persistent log file
    if (this.logFile) {
      try {
        const dir = path.dirname(this.logFile);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.appendFileSync(this.logFile, JSON.stringify(audit) + '\n', 'utf-8');
      } catch {
        // non-blocking file append
      }
    }

    // 4. Asynchronously stream to SIEM if configured
    if (this.siemExporter) {
      this.siemExporter.exportRecord(audit).catch(() => {});
    }

    if (this.logLevel === 'silent') return;

    const summary = Object.entries(audit.entityBreakdown)
      .map(([type, count]) => `${type}:${count}`)
      .join(', ');

    const policyStr = audit.policyAction ? ` | Policy: ${audit.policyAction}` : '';
    const riskStr = audit.riskScore !== undefined ? ` | Risk: ${audit.riskScore}` : '';
    const logLine = `[AUDIT] ${audit.timestamp} | Req: ${audit.requestId} | Model: ${audit.model} | Stream: ${audit.isStreaming} | Detected: ${audit.entitiesDetected} [${summary || 'none'}]${policyStr}${riskStr} | Process: ${audit.processingLatencyMs}ms | Upstream: ${audit.upstreamLatencyMs}ms | Status: ${audit.status} | Hash: ${audit.hash.substring(0, 12)}...`;

    if (this.logLevel === 'debug' || this.logLevel === 'info') {
      console.log(logLine);
    }
  }

  public getRecentLogs(): AuditRecord[] {
    return [...this.inMemoryAuditLog];
  }

  /**
   * Verifies the cryptographic integrity of in-memory hash chain.
   */
  public verifyIntegrity(): { valid: boolean; brokenAtIndex?: number; error?: string } {
    // Chronological order is reverse of inMemoryAuditLog
    const chronological = [...this.inMemoryAuditLog].reverse();
    return verifyAuditLogIntegrity(chronological);
  }

  public getStats() {
    const totalRequests = this.inMemoryAuditLog.length;
    let totalEntities = 0;
    const typeTotals: Record<string, number> = {};

    for (const item of this.inMemoryAuditLog) {
      totalEntities += item.entitiesDetected;
      for (const [k, v] of Object.entries(item.entityBreakdown)) {
        typeTotals[k] = (typeTotals[k] || 0) + v;
      }
    }

    return {
      totalRequests,
      totalEntitiesBlocked: totalEntities,
      typeTotals,
      hashChainValid: this.verifyIntegrity().valid,
      latestHash: this.lastRecordedHash,
    };
  }

  public clear(): void {
    this.inMemoryAuditLog = [];
    this.lastRecordedHash = GENESIS_HASH;
  }
}

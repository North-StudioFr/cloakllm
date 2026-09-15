/**
 * CloakLLM SIEM Exporter & Syslog RFC 5424 Formatter
 * Transmits structured zero-knowledge audit events to enterprise SIEM platforms
 * (Splunk HEC, Elastic Ingest, Datadog, Microsoft Sentinel, Syslog).
 * Zero external dependencies.
 */

import os from 'node:os';
import type { AuditRecord, SiemExporterConfig } from './types.ts';

/**
 * Formats an AuditRecord according to Syslog RFC 5424:
 * <PRI>VERSION TIMESTAMP HOSTNAME APP-NAME PROCID MSGID [STRUCTURED-DATA] MSG
 */
export function formatRfc5424Syslog(record: AuditRecord, appName: string = 'CloakLLM'): string {
  // Facility: 1 (user-level), Severity: 6 (Informational) -> PRI = 1 * 8 + 6 = 14
  // If status is ERROR, Severity: 3 (Error) -> PRI = 1 * 8 + 3 = 11
  const pri = record.status === 'ERROR' ? 11 : 14;
  const version = 1;
  const timestamp = record.timestamp || new Date().toISOString();
  const hostname = os.hostname() || 'localhost';
  const procId = process.pid;
  const msgId = record.requestId || '-';

  // Structured Data element (enterprise ID arbitrary or 32473 NorthStudio/CloakLLM)
  const breakdownStr = Object.entries(record.entityBreakdown || {})
    .map(([k, v]) => `${k}=${v}`)
    .join(';') || 'none';

  const sdParams = [
    `model="${record.model || 'unknown'}"`,
    `entities="${record.entitiesDetected}"`,
    `breakdown="${breakdownStr}"`,
    `process_ms="${record.processingLatencyMs}"`,
    `upstream_ms="${record.upstreamLatencyMs}"`,
    `streaming="${record.isStreaming}"`,
    `status="${record.status}"`,
  ];

  if (record.hash) {
    sdParams.push(`hash="${record.hash}"`);
  }
  if (record.previousHash) {
    sdParams.push(`prev_hash="${record.previousHash}"`);
  }

  const structuredData = `[cloakllm@32473 ${sdParams.join(' ')}]`;
  const message = `Zero-knowledge audit event for request ${record.requestId}`;

  return `<${pri}>${version} ${timestamp} ${hostname} ${appName} ${procId} ${msgId} ${structuredData} ${message}`;
}

export class SiemExporter {
  private config?: SiemExporterConfig;
  private fetchFn: typeof fetch;

  constructor(config?: SiemExporterConfig, fetchFn?: typeof fetch) {
    this.config = config;
    this.fetchFn = fetchFn || globalThis.fetch.bind(globalThis);
  }

  /**
   * Converts record to RFC 5424 syslog message.
   */
  public toSyslog(record: AuditRecord): string {
    return formatRfc5424Syslog(record, this.config?.syslog?.appName);
  }

  /**
   * Dispatches audit record to external SIEM webhook (Splunk, Elastic, Sentinel).
   */
  public async exportRecord(record: AuditRecord): Promise<boolean> {
    if (!this.config || !this.config.webhookUrl) {
      return false;
    }

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(this.config.headers || {}),
      };

      if (this.config.apiKey) {
        headers['Authorization'] = `Bearer ${this.config.apiKey}`;
      }

      const payload = {
        source: 'cloakllm',
        event: record,
        syslog: this.toSyslog(record),
        timestamp: record.timestamp,
      };

      const res = await this.fetchFn(this.config.webhookUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });

      return res.ok;
    } catch {
      // Non-blocking SIEM export
      return false;
    }
  }
}

#!/usr/bin/env node
/**
 * CloakLLM CLI Runner & Daemon Manager (v3.0)
 * Starts the local GDPR privacy firewall proxy with subcommands for daemon management,
 * MCP security proxying, document scanning, and cryptographic hash-chain verification.
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { CloakProxyServer } from './proxy.ts';
import type { CloakLLMConfig, LocalProviderType, EnvironmentProfile } from './types.ts';
import { resolveDefaultModel, resolveDefaultUrl } from './detectors/local-provider.ts';
import {
  startDaemon,
  stopDaemon,
  getDaemonStatus,
  tailLogs,
  exportAuditReport,
  writePidFile,
  removePidFile,
} from './daemon.ts';
import { McpSecurityProxy } from './mcp-proxy.ts';
import { DocumentScanner } from './document-scanner.ts';
import { verifyAuditLogIntegrity } from './logger.ts';

const options = {
  // Subcommands & daemon options
  daemon: { type: 'boolean', short: 'd', default: false },
  config: { type: 'string', short: 'c' },
  dictionary: { type: 'string' },
  policy: { type: 'string', short: 'P' },
  'audit-log': { type: 'string' },
  format: { type: 'string', default: 'json' },
  output: { type: 'string', short: 'o' },
  lines: { type: 'string', short: 'n', default: '50' },
  follow: { type: 'boolean', short: 'f', default: false },
  'internal-daemon-worker': { type: 'boolean', default: false },

  // Proxy network options
  port: { type: 'string', short: 'p', default: '8080' },
  host: { type: 'string', short: 'h', default: '127.0.0.1' },
  upstream: { type: 'string', short: 'u', default: 'https://api.openai.com/v1' },
  'api-key': { type: 'string', short: 'k' },
  'no-dashboard': { type: 'boolean', default: false },

  // V3 Security & FinOps Flags
  firewall: { type: 'boolean', default: true },
  canary: { type: 'boolean', default: false },
  'cost-guard': { type: 'boolean', default: true },
  'response-dlp': { type: 'boolean', default: true },
  entropy: { type: 'boolean', default: true },
  'siem-webhook': { type: 'string' },

  // Local SLM / Multi-Provider options
  'local-provider': { type: 'string', short: 'l' }, // ollama | openai-compatible | huggingface
  'local-url': { type: 'string' },
  'local-model': { type: 'string' },
  'local-key': { type: 'string' },
  profile: { type: 'string', default: 'workstation' }, // workstation | lan

  // Legacy Ollama options
  ollama: { type: 'boolean', default: false },
  'ollama-model': { type: 'string', default: 'llama3.2:1b' },
  'ollama-url': { type: 'string', default: 'http://127.0.0.1:11434' },

  verbose: { type: 'boolean', short: 'v', default: false },
  help: { type: 'boolean' },
} as const;

function printBanner(
  port: number,
  host: string,
  upstream: string,
  dashboardUrl: string,
  localSlmStatus: string,
  profile: string,
  dictStatus: string,
  policyStatus: string
) {
  console.log(`
\x1b[34m   ______ _             _    _      _      __  __ \x1b[0m
\x1b[34m  / _____| |           | |  | |    | |    |  \\/  |\x1b[0m
\x1b[34m | |     | | ___   __ _| | _| |    | |    | \\  / |\x1b[0m
\x1b[34m | |     | |/ _ \\ / _\` | |/ / |    | |    | |\\/| |\x1b[0m
\x1b[34m | |_____| | (_) | (_| |   <| |____| |____| |  | |\x1b[0m
\x1b[34m  \\______| |\\___/ \\__,_|_|\\_\\______|______|_|  |_|\x1b[0m
\x1b[32m  🛡️  Local GDPR Firewall & Reversible LLM Anonymizer (v3.0.0 Enterprise)\x1b[0m
\x1b[90m  ─────────────────────────────────────────────────────────────\x1b[0m
  \x1b[1mStatus:\x1b[0m       \x1b[32m● Running (Zero AI Loop, <5ms Overhead)\x1b[0m
  \x1b[1mProxy URL:\x1b[0m    \x1b[36mhttp://${host}:${port}/v1\x1b[0m
  \x1b[1mDashboard:\x1b[0m    \x1b[36m${dashboardUrl}\x1b[0m
  \x1b[1mDPO Audit:\x1b[0m    \x1b[36mhttp://${host}:${port}/api/compliance/report?format=html\x1b[0m
  \x1b[1mMCP Proxy:\x1b[0m    \x1b[36mhttp://${host}:${port}/mcp\x1b[0m
  \x1b[1mUpstream:\x1b[0m     \x1b[33m${upstream}\x1b[0m
  \x1b[1mPolicy:\x1b[0m       \x1b[35m${policyStatus}\x1b[0m
  \x1b[1mLocal SLM:\x1b[0m    \x1b[35m${localSlmStatus}\x1b[0m
  \x1b[1mProfile:\x1b[0m      \x1b[34m${profile}\x1b[0m
  \x1b[1mDictionary:\x1b[0m   \x1b[32m${dictStatus}\x1b[0m
  \x1b[1mCost:\x1b[0m         \x1b[32m0 € (100% Local / Open Source / Native)\x1b[0m
\x1b[90m  ─────────────────────────────────────────────────────────────\x1b[0m

  \x1b[35m👉 Quickstart (Python):\x1b[0m
     from openai import OpenAI
     client = OpenAI(base_url="http://${host}:${port}/v1", api_key="sk-local")

  \x1b[35m👉 Quickstart (curl):\x1b[0m
     curl http://${host}:${port}/v1/chat/completions \\
       -H "Content-Type: application/json" \\
       -d '{"model":"gpt-4o","messages":[{"role":"user","content":"SSN: 123-45-6789, NIR: 1850575108123"}]}'
`);
}

function printHelp() {
  console.log(`
CloakLLM v3.0 Enterprise — Local GDPR Privacy Firewall, AI Policy Engine & MCP Proxy

Usage:
  cloakllm [command] [options]

Commands:
  start                     Start the proxy (foreground or background with -d)
  stop                      Stop background daemon process
  status                    Check proxy daemon status, PID, and health
  logs                      View daemon execution logs (-f to follow)
  export-audit              Export DPO compliance report (JSON, HTML, Markdown)
  mcp-proxy                 Run stdio JSON-RPC security filter for MCP servers
  scan-doc <file>           Scan and sanitize multi-format document (CSV, JSON, EML, Markdown)
  verify-audit <file>       Cryptographically verify SHA-256 hash-chain of audit log

Options:
  -d, --daemon              Run in background as detached daemon service
  -c, --config <file>       Path to custom enterprise business dictionary (JSON/YAML)
  -P, --policy <file>       Path to declarative AI policy file (YAML/JSON)
  -p, --port <number>       Port to listen on (default: 8080)
  -h, --host <string>       Host address to bind (default: 127.0.0.1)
  -u, --upstream <url>      Upstream LLM base URL (default: https://api.openai.com/v1)
  -k, --api-key <key>       Default upstream API key
  --audit-log <file>        Persistent zero-knowledge audit log file (JSONL with SHA-256 seal)
  --siem-webhook <url>      Forward zero-knowledge audit records to SIEM webhook
  --no-dashboard            Disable embedded web dashboard

V3 Engines:
  --firewall                Enable deterministic prompt firewall (default: true)
  --canary                  Enable cryptographic honeytoken / canary tracking
  --cost-guard              Enable FinOps rate limiter and circuit breaker (default: true)
  --response-dlp            Enable bidirectional response DLP inspection (default: true)
  --entropy                 Enable Shannon entropy detector for secret keys (default: true)

Local SLM & NER Providers:
  -l, --local-provider <t>  Local NER engine: ollama | openai-compatible | huggingface
  --local-url <url>         Local provider URL (e.g. http://127.0.0.1:1234/v1)
  --local-model <model>     Local model name (e.g. llama3.2:1b, dslim/bert-base-NER)
  --profile <profile>       Environment preset: workstation (127.0.0.1) | lan

General:
  -v, --verbose             Enable verbose debug logging
  --help                    Show this help message
`);
}

async function main() {
  const { values, positionals } = parseArgs({ options, allowPositionals: true });

  if (values.help) {
    printHelp();
    process.exit(0);
  }

  const port = parseInt(values.port || '8080', 10);
  const host = values.host || '127.0.0.1';
  const command = (positionals[0] || '').toLowerCase();

  // Subcommand: stop
  if (command === 'stop') {
    await stopDaemon(host, port);
    process.exit(0);
  }

  // Subcommand: status
  if (command === 'status') {
    const status = await getDaemonStatus(host, port);
    if (status.isRunning) {
      console.log(`
\x1b[32m● CloakLLM Daemon is RUNNING\x1b[0m
  \x1b[1mPID:\x1b[0m         ${status.pid}
  \x1b[1mAddress:\x1b[0m     http://${status.host}:${status.port}
  \x1b[1mDashboard:\x1b[0m   http://${status.host}:${status.port}/dashboard
  \x1b[1mUptime:\x1b[0m      ${status.health?.uptime ? `${Math.round(status.health.uptime)}s` : 'active'}
  \x1b[1mVersion:\x1b[0m     ${status.health?.version || '3.0.0'}
`);
    } else {
      console.log(`\x1b[90m○ CloakLLM is STOPPED (not running on ${host}:${port})\x1b[0m`);
    }
    process.exit(0);
  }

  // Subcommand: logs
  if (command === 'logs') {
    const lines = parseInt(values.lines || '50', 10);
    tailLogs(lines, Boolean(values.follow));
    return;
  }

  // Subcommand: export-audit
  if (command === 'export-audit') {
    try {
      await exportAuditReport(values.format || 'json', values.output, host, port);
    } catch (err: any) {
      console.error(`\x1b[31mError exporting audit report:\x1b[0m ${err.message}`);
      process.exit(1);
    }
    process.exit(0);
  }

  // Subcommand: scan-doc <file>
  if (command === 'scan-doc') {
    const filePath = positionals[1];
    if (!filePath) {
      console.error('\x1b[31mError:\x1b[0m File path required: cloakllm scan-doc <file>');
      process.exit(1);
    }
    try {
      const scanner = new DocumentScanner();
      const result = scanner.scanDocumentFile(filePath);
      if (values.output) {
        fs.writeFileSync(path.resolve(values.output), result.sanitizedContent, 'utf-8');
        console.log(`\x1b[32mSanitized document written to:\x1b[0m ${values.output}`);
      } else {
        console.log(JSON.stringify(result, null, 2));
      }
    } catch (err: any) {
      console.error(`\x1b[31mDocument scan error:\x1b[0m ${err.message}`);
      process.exit(1);
    }
    process.exit(0);
  }

  // Subcommand: verify-audit <file>
  if (command === 'verify-audit') {
    const filePath = positionals[1] || values['audit-log'];
    if (!filePath) {
      console.error('\x1b[31mError:\x1b[0m Audit file path required: cloakllm verify-audit <file>');
      process.exit(1);
    }
    try {
      const resolved = path.resolve(filePath);
      const lines = fs.readFileSync(resolved, 'utf-8').trim().split('\n').filter(Boolean);
      const records = lines.map(l => JSON.parse(l));
      const verification = verifyAuditLogIntegrity(records);
      if (verification.valid) {
        console.log(`\x1b[32m✔ Cryptographic Hash-Chain VALID:\x1b[0m ${records.length} records verified with zero tampering.`);
      } else {
        console.error(`\x1b[31m✖ Hash-Chain BROKEN:\x1b[0m ${verification.error}`);
        process.exit(1);
      }
    } catch (err: any) {
      console.error(`\x1b[31mVerification error:\x1b[0m ${err.message}`);
      process.exit(1);
    }
    process.exit(0);
  }

  // Subcommand: mcp-proxy [cmd] [...args]
  if (command === 'mcp-proxy') {
    const mcpProxy = new McpSecurityProxy();
    const subArgs = positionals.slice(1);

    if (subArgs.length > 0) {
      const { spawn } = await import('node:child_process');
      const [cmd, ...cmdArgs] = subArgs;
      const child = spawn(cmd, cmdArgs, {
        stdio: ['pipe', 'pipe', 'inherit'],
        env: process.env,
      });

      const vault = new SessionVault();
      process.stdin
        .pipe(mcpProxy.createTransformStream(vault, 'client_to_server'))
        .pipe(child.stdin);

      child.stdout
        .pipe(mcpProxy.createTransformStream(vault, 'server_to_client'))
        .pipe(process.stdout);

      child.on('exit', (code) => {
        process.exit(code ?? 0);
      });

      child.on('error', (err) => {
        console.error('Failed to spawn MCP target server:', err);
        process.exit(1);
      });
      return;
    }

    // Direct filter mode (stdin -> sanitize -> stdout)
    process.stdin
      .pipe(mcpProxy.createTransformStream(undefined, 'client_to_server'))
      .pipe(process.stdout);
    return;
  }

  // Check if daemon flag was passed
  const shouldRunDaemon = values.daemon && !values['internal-daemon-worker'];
  if (shouldRunDaemon) {
    await startDaemon(process.argv.slice(2), host, port);
    process.exit(0);
  }

  // Otherwise: Start proxy server (in foreground or as spawned daemon worker)
  const upstreamUrl = values.upstream || 'https://api.openai.com/v1';

  let providerType: LocalProviderType | undefined;
  if (values['local-provider']) {
    providerType = values['local-provider'] as LocalProviderType;
  } else if (values.ollama) {
    providerType = 'ollama';
  }

  const profile = (values.profile === 'lan' ? 'lan' : 'workstation') as EnvironmentProfile;
  const enableLocalSLM = Boolean(providerType);

  const localModelUrl = providerType
    ? resolveDefaultUrl(providerType, profile, values['local-url'] || values['ollama-url'])
    : undefined;

  const localModelName = providerType
    ? resolveDefaultModel(providerType, values['local-model'] || values['ollama-model'])
    : undefined;

  const customConfigFile = values.config || values.dictionary;
  const policyConfigFile = values.policy;

  const config: CloakLLMConfig = {
    port,
    host,
    upstreamUrl,
    upstreamApiKey: values['api-key'],
    enabledDetectors: [
      'EMAIL',
      'PHONE',
      'IBAN',
      'NIR',
      'SSN',
      'NINO',
      'CREDIT_CARD',
      'AMOUNT',
      'SECRET',
      'IP_ADDRESS',
      'PERSON',
      'ORGANIZATION',
      'SIRET',
      'PROJECT',
      'CLIENT',
      'INTERNAL_IP',
      'CUSTOM',
    ],
    customConfigFile,
    policyConfigFile,
    enableFirewall: values.firewall,
    enableCanary: values.canary,
    enableCostGuard: values['cost-guard'],
    enableResponseDlp: values['response-dlp'],
    enableEntropy: values.entropy,
    siemConfig: values['siem-webhook'] ? { webhookUrl: values['siem-webhook'] } : undefined,
    auditLogFile: values['audit-log'],
    enableDashboard: !values['no-dashboard'],
    enableOllama: providerType === 'ollama',
    ollamaModel: values['ollama-model'],
    ollamaUrl: values['ollama-url'],
    enableLocalSLM,
    localProvider: providerType,
    localModelUrl,
    localModelName,
    localModelApiKey: values['local-key'],
    environmentProfile: profile,
    logLevel: values.verbose ? 'debug' : 'info',
  };

  const server = new CloakProxyServer(config);
  await server.start();

  if (values['internal-daemon-worker']) {
    writePidFile(process.pid, { port, host });
  }

  const dashboardUrl = config.enableDashboard ? `http://${host}:${port}/dashboard` : 'disabled';
  let localSlmStatus = 'Disabled (Fast Native Deterministic Engines)';
  if (enableLocalSLM && providerType) {
    localSlmStatus = `Active: ${providerType} (${localModelName}) @ ${localModelUrl}`;
  }

  const dictStatus = customConfigFile ? `Loaded (${customConfigFile})` : 'Default Patterns';
  const policyStatus = policyConfigFile ? `Active (${policyConfigFile})` : 'Default (ALLOW/CLOAK)';

  if (!values['internal-daemon-worker']) {
    printBanner(port, host, upstreamUrl, dashboardUrl, localSlmStatus, profile.toUpperCase(), dictStatus, policyStatus);
  } else {
    console.log(`[CloakLLM Daemon] Proxy started on http://${host}:${port} (PID: ${process.pid})`);
  }

  const shutdown = async () => {
    if (!values['internal-daemon-worker']) {
      console.log('\nStopping CloakLLM proxy...');
    }
    if (values['internal-daemon-worker']) {
      removePidFile();
    }
    await server.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Fatal error starting CloakLLM:', err);
  process.exit(1);
});

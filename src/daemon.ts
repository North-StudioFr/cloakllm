/**
 * CloakLLM CLI Daemon & Process Manager
 * Handles background daemon lifecycle: start, stop, status, logs, and audit export.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export interface DaemonPaths {
  dir: string;
  pidFile: string;
  logFile: string;
}

export function getDaemonPaths(): DaemonPaths {
  const candidates = [
    process.env.CLOAKLLM_HOME,
    path.join(process.cwd(), '.cloakllm'),
    path.join(os.homedir(), '.cloakllm'),
    path.join(os.tmpdir(), 'cloakllm'),
  ].filter(Boolean) as string[];

  let chosenDir = candidates[0];

  for (const dir of candidates) {
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      chosenDir = dir;
      break;
    } catch {
      // try next candidate
    }
  }

  return {
    dir: chosenDir,
    pidFile: path.join(chosenDir, 'cloakllm.pid'),
    logFile: path.join(chosenDir, 'cloakllm.log'),
  };
}

export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    return e.code === 'EPERM';
  }
}

export interface DaemonState {
  pid: number;
  port: number;
  host: string;
  startedAt?: string;
}

export function readDaemonState(): DaemonState | null {
  const { pidFile } = getDaemonPaths();
  if (!fs.existsSync(pidFile)) return null;
  try {
    const content = fs.readFileSync(pidFile, 'utf-8').trim();
    if (content.startsWith('{')) {
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed.pid === 'number') {
        return {
          pid: parsed.pid,
          port: typeof parsed.port === 'number' ? parsed.port : 8080,
          host: typeof parsed.host === 'string' ? parsed.host : '127.0.0.1',
          startedAt: parsed.startedAt,
        };
      }
    }
    const pid = parseInt(content, 10);
    return isNaN(pid) ? null : { pid, port: 8080, host: '127.0.0.1' };
  } catch {
    return null;
  }
}

export function readPidFile(): number | null {
  const state = readDaemonState();
  return state ? state.pid : null;
}

export function writePidFile(pid: number, info?: { port?: number; host?: string }): void {
  const { pidFile } = getDaemonPaths();
  const state: DaemonState = {
    pid,
    port: info?.port ?? 8080,
    host: info?.host ?? '127.0.0.1',
    startedAt: new Date().toISOString(),
  };
  fs.writeFileSync(pidFile, JSON.stringify(state, null, 2), 'utf-8');
}

export function removePidFile(): void {
  const { pidFile } = getDaemonPaths();
  if (fs.existsSync(pidFile)) {
    try {
      fs.unlinkSync(pidFile);
    } catch {
      // ignore
    }
  }
}

export async function pingHealth(
  host: string = '127.0.0.1',
  port: number = 8080,
  fetchFn: typeof fetch = globalThis.fetch
): Promise<{ status: string; uptime?: number; version?: string } | null> {
  try {
    const res = await fetchFn(`http://${host}:${port}/health`);
    if (res.ok) {
      return (await res.json()) as any;
    }
  } catch {
    // unreachable
  }
  return null;
}

export async function getDaemonStatus(host: string = '127.0.0.1', port: number = 8080) {
  const state = readDaemonState();
  if (!state) {
    return { isRunning: false, pid: null, health: null, port, host };
  }

  const alive = isProcessRunning(state.pid);
  if (!alive) {
    removePidFile();
    return { isRunning: false, pid: null, health: null, port, host };
  }

  const effectivePort = port !== 8080 ? port : state.port;
  const effectiveHost = host !== '127.0.0.1' ? host : state.host;

  const health = await pingHealth(effectiveHost, effectivePort);
  return { isRunning: true, pid: state.pid, health, port: effectivePort, host: effectiveHost };
}

export async function startDaemon(
  cliArgs: string[],
  host: string = '127.0.0.1',
  port: number = 8080
): Promise<number> {
  const status = await getDaemonStatus(host, port);
  if (status.isRunning) {
    console.log(`\x1b[33m⚠️  CloakLLM is already running in background (PID: ${status.pid}) on http://${host}:${port}\x1b[0m`);
    return status.pid!;
  }

  const { logFile } = getDaemonPaths();
  const logFd = fs.openSync(logFile, 'a');

  // Locate cli.ts
  const thisFile = fileURLToPath(import.meta.url);
  const cliPath = path.resolve(path.dirname(thisFile), 'cli.ts');

  // Filter out '--daemon' and '-d' and 'start' subcommand from forwarded arguments
  const forwardedArgs = cliArgs.filter(
    arg => arg !== 'start' && arg !== '--daemon' && arg !== '-d'
  );

  const nodeArgs = [
    '--experimental-strip-types',
    cliPath,
    ...forwardedArgs,
    '--internal-daemon-worker',
  ];

  const child = spawn(process.execPath, nodeArgs, {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    cwd: process.cwd(),
    env: process.env,
  });

  if (!child.pid) {
    throw new Error('Failed to spawn daemon process');
  }

  writePidFile(child.pid, { port, host });
  child.unref();

  // Wait a short moment to check if process stays alive
  await new Promise(r => setTimeout(r, 400));
  if (!isProcessRunning(child.pid)) {
    removePidFile();
    throw new Error(`Daemon process exited immediately. Inspect logs at: ${logFile}`);
  }

  console.log(`
\x1b[32m✔ CloakLLM Daemon successfully started in background!\x1b[0m
  \x1b[1mPID:\x1b[0m          \x1b[36m${child.pid}\x1b[0m
  \x1b[1mProxy URL:\x1b[0m    \x1b[36mhttp://${host}:${port}/v1\x1b[0m
  \x1b[1mDashboard:\x1b[0m    \x1b[36mhttp://${host}:${port}/dashboard\x1b[0m
  \x1b[1mLog File:\x1b[0m     \x1b[90m${logFile}\x1b[0m

\x1b[35mCommands:\x1b[0m
  cloakllm status          # Check daemon health & uptime
  cloakllm logs -f         # Stream live logs
  cloakllm export-audit    # Export GDPR compliance report
  cloakllm stop            # Stop background proxy
`);

  return child.pid;
}

export async function stopDaemon(host: string = '127.0.0.1', port: number = 8080): Promise<boolean> {
  const pid = readPidFile();
  if (!pid) {
    console.log('\x1b[33m● CloakLLM is not running (no PID file found).\x1b[0m');
    return false;
  }

  if (!isProcessRunning(pid)) {
    console.log(`\x1b[33m● Cleaning stale PID file (${pid}). Process already stopped.\x1b[0m`);
    removePidFile();
    return false;
  }

  console.log(`Stopping CloakLLM daemon (PID: ${pid})...`);
  try {
    process.kill(pid, 'SIGTERM');
  } catch (e) {
    console.error(`Error sending SIGTERM to PID ${pid}:`, e);
  }

  // Poll until process exits (up to 3 seconds)
  const maxWait = 30;
  for (let i = 0; i < maxWait; i++) {
    await new Promise(r => setTimeout(r, 100));
    if (!isProcessRunning(pid)) {
      break;
    }
  }

  if (isProcessRunning(pid)) {
    console.warn(`Daemon did not stop gracefully. Sending SIGKILL to PID ${pid}...`);
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // ignore
    }
  }

  removePidFile();
  console.log('\x1b[32m✔ CloakLLM daemon stopped.\x1b[0m');
  return true;
}

export function tailLogs(linesCount: number = 50, follow: boolean = false): void {
  const { logFile } = getDaemonPaths();
  if (!fs.existsSync(logFile)) {
    console.log(`No logs found at ${logFile}. Start the proxy first with 'cloakllm start'.`);
    return;
  }

  const content = fs.readFileSync(logFile, 'utf-8');
  const lines = content.split('\n');
  const recent = lines.slice(-linesCount).join('\n');
  process.stdout.write(recent + '\n');

  if (follow) {
    console.log(`\x1b[90m--- Following ${logFile} (Press Ctrl+C to exit) ---\x1b[0m`);
    let lastSize = fs.statSync(logFile).size;
    const interval = setInterval(() => {
      try {
        const stat = fs.statSync(logFile);
        if (stat.size > lastSize) {
          const stream = fs.createReadStream(logFile, { start: lastSize, end: stat.size });
          stream.pipe(process.stdout);
          lastSize = stat.size;
        }
      } catch {
        // file might be rotated
      }
    }, 500);

    process.on('SIGINT', () => {
      clearInterval(interval);
      process.exit(0);
    });
  }
}

export async function exportAuditReport(
  format: string = 'json',
  outputFile?: string,
  host: string = '127.0.0.1',
  port: number = 8080,
  fetchFn: typeof fetch = globalThis.fetch
): Promise<string> {
  const state = readDaemonState();
  const effectivePort = port !== 8080 ? port : (state?.port ?? port);
  const effectiveHost = host !== '127.0.0.1' ? host : (state?.host ?? host);
  const url = `http://${effectiveHost}:${effectivePort}/api/compliance/report?format=${encodeURIComponent(format)}`;

  let data: string;
  try {
    const res = await fetchFn(url);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    data = await res.text();
  } catch (err: any) {
    throw new Error(
      `Could not connect to CloakLLM at ${host}:${port}. Ensure proxy is running with 'cloakllm start'. Detail: ${err.message}`
    );
  }

  if (outputFile) {
    const resolved = path.resolve(outputFile);
    fs.writeFileSync(resolved, data, 'utf-8');
    console.log(`\x1b[32m✔ DPO Compliance Report exported to: ${resolved}\x1b[0m`);
  } else {
    process.stdout.write(data + '\n');
  }
  return data;
}

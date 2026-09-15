#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const currentFile = fileURLToPath(import.meta.url);
const cliTs = path.resolve(path.dirname(currentFile), '../src/cli.ts');

try {
  await import('../src/cli.ts');
} catch {
  const result = spawnSync(process.execPath, ['--experimental-strip-types', cliTs, ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: process.env,
  });
  process.exit(result.status ?? 0);
}

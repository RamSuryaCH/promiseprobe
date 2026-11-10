#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(here, '..', 'src', 'cli.ts');
const require = createRequire(import.meta.url);

let tsxCli;
try {
  tsxCli = require.resolve('tsx/cli');
} catch {
  console.error('promiseprobe: tsx is not installed. Run npm install in the promiseprobe package.');
  process.exit(1);
}

const child = spawn(process.execPath, [tsxCli, entry, ...process.argv.slice(2)], {
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

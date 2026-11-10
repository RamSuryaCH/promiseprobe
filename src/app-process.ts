import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { PromiseContract } from './types.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function packageRootOf(file: string): string {
  let dir = path.dirname(file);
  while (true) {
    if (existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.dirname(file);
    dir = parent;
  }
}

export function healthUrl(appUrl: string): string {
  const url = new URL(appUrl);
  url.pathname = '/health';
  url.search = '';
  url.hash = '';
  return url.toString();
}

async function isHealthy(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }, 1_000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    if (child.exitCode !== null || child.signalCode !== null) {
      clearTimeout(timer);
      resolve();
      return;
    }
    child.kill('SIGTERM');
  });
}

/**
 * Start the app declared on the promise and resolve when `/health` answers.
 * The returned function stops the process this call started.
 */
export async function startApp(contract: PromiseContract): Promise<() => Promise<void>> {
  const ready = healthUrl(contract.app.url);
  const start = contract.app.start;
  if (!start) {
    const timeout = 15_000;
    const began = Date.now();
    while (Date.now() - began < timeout) {
      if (await isHealthy(ready)) return async () => {};
      await sleep(100);
    }
    throw new Error(`App did not answer ${ready}. Start it yourself or set app.start.`);
  }

  if (await isHealthy(ready)) {
    throw new Error(
      `${ready} is already in use. Stop that process before running PromiseProbe so the sweep talks to the app under test.`,
    );
  }

  const root = packageRootOf(start.file);
  const child = spawn(process.execPath, ['--import', 'tsx', start.file], {
    cwd: root,
    env: { ...process.env, ...start.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let logs = '';
  const capture = (chunk: Buffer | string) => {
    logs += String(chunk);
    if (logs.length > 16_000) logs = logs.slice(-16_000);
    if (process.env.PROMISEPROBE_DEBUG) process.stderr.write(String(chunk));
  };
  child.stdout?.on('data', capture);
  child.stderr?.on('data', capture);

  const exitState: { current: { code: number | null; signal: NodeJS.Signals | null } | null } = {
    current: null,
  };
  child.once('exit', (code, signal) => {
    exitState.current = { code, signal };
  });

  const timeout = start.readyTimeoutMs ?? 15_000;
  const began = Date.now();
  while (Date.now() - began < timeout) {
    const exited = exitState.current;
    if (exited) {
      throw new Error(
        `App exited before ${ready} was ready (code ${exited.code ?? 'null'}, signal ${exited.signal ?? 'null'}).\n${logs}`,
      );
    }
    if (await isHealthy(ready)) {
      return async () => {
        await stopChild(child);
      };
    }
    await sleep(100);
  }

  await stopChild(child);
  throw new Error(`Timed out waiting for ${ready}.\n${logs}`);
}

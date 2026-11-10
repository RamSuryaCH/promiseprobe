import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { chromium, type Browser } from 'playwright';

const require = createRequire(import.meta.url);

const LAUNCH_ARGS = ['--no-sandbox', '--disable-dev-shm-usage'];

let install: Promise<void> | null = null;

function installChromium(): Promise<void> {
  if (!install) {
    install = new Promise((resolve, reject) => {
      const cli = require.resolve('playwright/cli');
      const child = spawn(process.execPath, [cli, 'install', 'chromium'], { stdio: 'inherit' });
      child.on('error', reject);
      child.on('exit', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`playwright install chromium exited ${code}`));
      });
    });
  }
  return install;
}

export async function launchBrowser(): Promise<Browser> {
  try {
    return await chromium.launch({ headless: true, args: LAUNCH_ARGS });
  } catch (first) {
    try {
      await installChromium();
    } catch (installError) {
      const reason = installError instanceof Error ? installError.message : String(installError);
      const launch = first instanceof Error ? first.message : String(first);
      throw new Error(`${launch}\nTried to install Chromium and failed: ${reason}`);
    }
    return chromium.launch({ headless: true, args: LAUNCH_ARGS });
  }
}

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { definePromise, type PromiseContract, type RunContext, type ScenarioId } from '../../src/index.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
const port = '4175';

async function saved(ctx: RunContext): Promise<boolean> {
  const text = await ctx.page.getByTestId('status').textContent();
  return (text ?? '').trim() === 'Saved ✓';
}

async function durable(ctx: RunContext): Promise<boolean> {
  return ctx.page.evaluate((expected) => localStorage.getItem('promiseprobe-draft') === expected, ctx.bag.text ?? '');
}

async function persisted(ctx: RunContext) {
  const value = await ctx.page.evaluate(() => localStorage.getItem('promiseprobe-draft'));
  const count = value === ctx.bag.text ? 1 : 0;
  return {
    count,
    detail: count === 1 ? 'draft present in localStorage' : 'localStorage empty',
  };
}

function draft(mode: string, name: string, scenarios?: ScenarioId[], settleMs = 800): PromiseContract {
  return definePromise({
    name,
    guarantee: 'local',
    app: {
      url: `http://127.0.0.1:${port}/?mode=${mode}`,
      start: {
        file: path.join(dir, 'server.ts'),
        env: { PORT: port },
      },
    },
    prepare: async ({ page, bag }) => {
      await page.getByLabel('Note').fill(bag.text ?? '');
    },
    action: async ({ page }) => {
      await page.getByRole('button', { name: 'Save' }).click();
    },
    successIndicator: saved,
    durabilitySignal: durable,
    persistenceCheck: persisted,
    scenarios,
    settleMs,
  });
}

const good = draft('good', 'Save a draft');
export const early = draft('early', 'Save a draft early', ['response-delay'], 1200);
export const lie = draft('lie', 'Save a draft that lies', ['offline'], 600);
export default good;

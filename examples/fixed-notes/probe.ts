import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { definePromise, type RunContext } from '../../src/index.js';

const dir = path.dirname(fileURLToPath(import.meta.url));

async function saved(ctx: RunContext): Promise<boolean> {
  const text = await ctx.page.getByTestId('status').textContent();
  return (text ?? '').trim() === 'Saved ✓';
}

async function persisted(ctx: RunContext) {
  const url = new URL('/api/notes', ctx.appUrl);
  url.searchParams.set('text', ctx.bag.text ?? '');
  const res = await ctx.request.get(url.toString());
  if (!res.ok()) throw new Error(`store responded ${res.status()}`);
  const body = (await res.json()) as { notes: unknown[] };
  const count = body.notes.length;
  const noun = count === 1 ? 'note' : 'notes';
  return { count, detail: `${count} matching ${noun} in the store` };
}

export default definePromise({
  name: 'Save a note',
  guarantee: 'remote',
  app: {
    url: 'http://127.0.0.1:4174',
    start: {
      file: path.join(dir, 'server.ts'),
      env: { PORT: '4174' },
    },
  },
  prepare: async ({ page, bag }) => {
    await page.getByLabel('Note').fill(bag.text ?? '');
  },
  action: async ({ page }) => {
    await page.getByRole('button', { name: 'Save' }).click();
  },
  successIndicator: saved,
  persistenceCheck: persisted,
});

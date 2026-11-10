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
    url: 'http://127.0.0.1:4173',
    start: {
      file: path.join(dir, 'server.ts'),
      env: { PORT: '4173' },
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
  seededDefects: [
    {
      id: 'optimistic-indicator',
      scenario: 'response-delay',
      verdict: 'premature-indicator',
      summary: 'Shows Saved before the response arrives.',
    },
    {
      id: 'success-without-persist',
      scenario: 'request-dropped',
      verdict: 'broken-promise',
      summary: 'Shows Saved when the request never reaches the server.',
    },
    {
      id: 'lost-ack-duplicate',
      scenario: 'response-dropped',
      verdict: 'duplicate-side-effect',
      summary: 'Retries a lost acknowledgement with a second POST and no idempotency key.',
    },
    {
      id: 'restart-loses-note',
      scenario: 'restart-after-success',
      verdict: 'broken-promise',
      summary: 'The write is still scheduled, not durable, when the success indicator appears.',
    },
    {
      id: 'double-submit',
      scenario: 'double-submit',
      verdict: 'duplicate-side-effect',
      summary: 'A second click inserts a second note.',
    },
  ],
});

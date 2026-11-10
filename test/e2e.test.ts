import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import broken from '../examples/broken-notes/probe.js';
import fixed from '../examples/fixed-notes/probe.js';
import localGood, { early, lie } from '../examples/local-draft/probe.js';
import { runProbe } from '../src/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function outDir(name: string): Promise<string> {
  return mkdtemp(path.join(tmpdir(), `promiseprobe-${name}-`));
}

describe('end to end', () => {
  it('catches every seeded defect in the broken notes app', async () => {
    const dir = await outDir('broken');
    const report = await runProbe(broken, {
      outDir: dir,
      probeFile: path.join(root, 'examples/broken-notes/probe.ts'),
    });
    expect(report.summary.errors).toBe(0);
    expect(report.seededDefects.every((defect) => defect.detected)).toBe(true);
    expect(report.scenarios.find((scenario) => scenario.scenario === 'offline')?.verdict).toBe('broken-promise');
    expect(report.witnesses.length).toBeGreaterThanOrEqual(5);
    expect(report.witnesses.find((witness) => witness.scenario === 'response-delay')?.delayMs).toBe(0);
    expect(report.output?.html).toBeTruthy();
    expect(report.witnessSource).toContain('broken-promise');
  }, 180_000);

  it('honours the promise in the fixed notes app', async () => {
    const dir = await outDir('fixed');
    const report = await runProbe(fixed, {
      outDir: dir,
      probeFile: path.join(root, 'examples/fixed-notes/probe.ts'),
    });
    expect(report.summary.errors).toBe(0);
    expect(report.summary.honoured).toBe(report.summary.total);
    expect(report.summary.total).toBe(6);
    expect(report.witnesses).toHaveLength(0);
  }, 180_000);

  it('treats a local draft as durable across reload and offline', async () => {
    const report = await runProbe(localGood, { reduce: false });
    expect(report.summary.errors).toBe(0);
    expect(report.summary.honoured).toBe(report.summary.total);
  }, 120_000);

  it('flags a local indicator that leads the write', async () => {
    const report = await runProbe(early, { reduce: false });
    expect(report.summary.errors).toBe(0);
    expect(report.scenarios[0]?.verdict).toBe('premature-indicator');
  }, 60_000);

  it('flags a local success claim that never writes', async () => {
    const report = await runProbe(lie, { reduce: false });
    expect(report.summary.errors).toBe(0);
    expect(report.scenarios[0]?.verdict).toBe('broken-promise');
  }, 60_000);
});

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import broken from '../examples/broken-notes/probe.js';
import fixed from '../examples/fixed-notes/probe.js';
import { runProbe, type Report } from '../src/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repeats = 5;

const brokenRuns: Report[] = [];
for (let i = 0; i < repeats; i += 1) {
  const report = await runProbe(broken, { reduce: false });
  brokenRuns.push(report);
  const caught = report.seededDefects.filter((defect) => defect.detected).length;
  console.log(`broken ${i + 1}/${repeats}  ${caught}/${report.seededDefects.length} seeded  ${(report.durationMs / 1000).toFixed(1)}s  errors ${report.summary.errors}`);
}

const fixedRuns: Report[] = [];
for (let i = 0; i < repeats; i += 1) {
  const report = await runProbe(fixed, { reduce: false });
  fixedRuns.push(report);
  console.log(`fixed  ${i + 1}/${repeats}  ${report.summary.honoured}/${report.summary.total} honoured  ${(report.durationMs / 1000).toFixed(1)}s  errors ${report.summary.errors}`);
}

const defectIds = brokenRuns[0]?.seededDefects.map((defect) => defect.id) ?? [];
const byDefect = defectIds.map((id) => {
  const hits = brokenRuns.filter((report) => report.seededDefects.find((defect) => defect.id === id)?.detected).length;
  return { id, hits, runs: brokenRuns.length };
});
const defectChecks = byDefect.reduce((sum, row) => sum + row.runs, 0);
const defectHits = byDefect.reduce((sum, row) => sum + row.hits, 0);
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

const metrics = {
  repeats,
  broken: {
    meanRuntimeMs: mean(brokenRuns.map((report) => report.durationMs)),
    seeded: byDefect,
    reproduction: { hits: defectHits, checks: defectChecks },
    scenarioVerdicts: brokenRuns.map((report) =>
      Object.fromEntries(report.scenarios.map((scenario) => [scenario.scenario, scenario.verdict])),
    ),
  },
  fixed: {
    meanRuntimeMs: mean(fixedRuns.map((report) => report.durationMs)),
    honouredRuns: fixedRuns.filter((report) => report.summary.honoured === report.summary.total && report.summary.errors === 0).length,
  },
};

const out = path.join(root, 'reports/metrics.json');
await mkdir(path.dirname(out), { recursive: true });
await writeFile(out, `${JSON.stringify(metrics, null, 2)}\n`);
console.log(JSON.stringify(metrics, null, 2));

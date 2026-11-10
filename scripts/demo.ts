import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import broken from '../examples/broken-notes/probe.js';
import fixed from '../examples/fixed-notes/probe.js';
import { launchBrowser } from '../src/browser.js';
import { runProbe } from '../src/index.js';
import type { Report } from '../src/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function line(report: Report): string {
  const summary = report.summary;
  const seeded = report.seededDefects.length
    ? ` · seeded ${report.seededDefects.filter((defect) => defect.detected).length}/${report.seededDefects.length}`
    : '';
  return `${summary.honoured} honoured, ${summary.brokenPromise} broken, ${summary.duplicateSideEffect} duplicate, ${summary.prematureIndicator} premature${seeded} · ${(report.durationMs / 1000).toFixed(1)}s`;
}

async function shoot(html: string, dest: string): Promise<void> {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ viewport: { width: 1120, height: 900 } });
    await page.goto(pathToFileURL(html).href, { waitUntil: 'load', timeout: 20_000 });
    await Promise.race([
      page.evaluate(() => document.fonts.ready),
      new Promise((resolve) => setTimeout(resolve, 2_000)),
    ]);
    await mkdir(path.dirname(dest), { recursive: true });
    await page.screenshot({ path: dest, fullPage: true });
  } finally {
    await browser.close();
  }
}

const brokenReport = await runProbe(broken, {
  outDir: path.join(root, 'reports/broken'),
  probeFile: path.join(root, 'examples/broken-notes/probe.ts'),
});
const fixedReport = await runProbe(fixed, {
  outDir: path.join(root, 'reports/fixed'),
  probeFile: path.join(root, 'examples/fixed-notes/probe.ts'),
});

console.log(`\nBroken notes  ${line(brokenReport)}`);
console.log(`Fixed notes   ${line(fixedReport)}`);
if (brokenReport.output) console.log(`broken report ${brokenReport.output.html}`);
if (fixedReport.output) console.log(`fixed report  ${fixedReport.output.html}`);

const brokenCaught = brokenReport.seededDefects.every((defect) => defect.detected);
const fixedHolds = fixedReport.summary.errors === 0 && fixedReport.summary.honoured === fixedReport.summary.total;

if (brokenCaught && fixedHolds && brokenReport.output && fixedReport.output) {
  await shoot(brokenReport.output.html, path.join(root, 'docs/report-broken.png'));
  await shoot(fixedReport.output.html, path.join(root, 'docs/report-fixed.png'));
  console.log('screenshots docs/report-broken.png docs/report-fixed.png');
}

if (!brokenCaught || !fixedHolds) {
  console.error('\nExpected the broken app to trip every seeded defect and the fixed app to honour every scenario.');
  process.exit(1);
}

console.log('\nBroken app is caught. Fixed app holds.');

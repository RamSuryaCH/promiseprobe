import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderHtmlReport } from './html-report.js';
import type { Report } from './types.js';
import { renderWitness, witnessCases } from './witness.js';

const libraryEntry = fileURLToPath(new URL('./index.ts', import.meta.url));

export async function writeReport(
  report: Report,
  outDir: string,
  probeFile?: string,
): Promise<NonNullable<Report['output']>> {
  const directory = path.resolve(outDir);
  await mkdir(path.join(directory, 'traces'), { recursive: true });
  const html = path.join(directory, 'report.html');
  const json = path.join(directory, 'report.json');
  let witness: string | undefined;

  if (report.witnesses.length > 0 && probeFile) {
    witness = path.join(directory, 'witness.spec.ts');
    report.witnessSource = renderWitness({
      witnessFile: witness,
      probeFile: path.resolve(probeFile),
      libraryEntry,
      promiseName: report.name,
      cases: witnessCases(report.witnesses),
    });
  }

  const output = { directory, html, json, witness };
  report.output = output;
  await writeFile(json, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(html, renderHtmlReport(report));
  if (witness && report.witnessSource) await writeFile(witness, report.witnessSource);
  return output;
}

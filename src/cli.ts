import path from 'node:path';
import { loadProbe } from './load-probe.js';
import { runProbe } from './runner.js';
import { VERDICT_LABEL, type Report, type Verdict } from './types.js';

interface Flags {
  probe?: string;
  out?: string;
  strict: boolean;
  reduce: boolean;
  repeat: number;
  help: boolean;
}

function usage(): string {
  return `PromiseProbe

Usage
  promiseprobe run <probe-file> [--out dir] [--strict] [--no-reduce] [--repeat n]

The probe file default-exports definePromise(...). PromiseProbe starts app.start,
sweeps interruption scenarios, and writes report.html, report.json, and, when
something fails, a standalone witness.spec.ts.
`;
}

function parse(argv: string[]): Flags {
  const flags: Flags = { strict: false, reduce: true, repeat: 1, help: false };
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') flags.help = true;
    else if (arg === '--strict') flags.strict = true;
    else if (arg === '--no-reduce') flags.reduce = false;
    else if (arg === '--out') {
      const value = argv[++i];
      if (!value) throw new Error('--out needs a directory');
      flags.out = value;
    } else if (arg === '--repeat') {
      const value = Number(argv[++i]);
      if (!Number.isInteger(value) || value < 1) throw new Error('--repeat needs a positive integer');
      flags.repeat = value;
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown option ${arg}`);
    } else {
      rest.push(arg);
    }
  }
  if (rest[0] === 'run') rest.shift();
  if (rest.length > 1) throw new Error(`Unexpected argument ${rest[1]}`);
  flags.probe = rest[0];
  return flags;
}

function paint(verdict: Verdict | null, enabled: boolean): string {
  const label = verdict ? VERDICT_LABEL[verdict] : 'error';
  if (!enabled || !verdict) return label;
  const codes: Record<Verdict, number> = {
    honoured: 32,
    'broken-promise': 31,
    'duplicate-side-effect': 33,
    'premature-indicator': 35,
  };
  return `\u001b[${codes[verdict]}m${label}\u001b[0m`;
}

function printReport(report: Report, color: boolean): void {
  console.log(`\n${report.name}  (${report.guarantee})`);
  const width = Math.max(...report.scenarios.map((scenario) => scenario.title.length), 10);
  for (const scenario of report.scenarios) {
    console.log(`  ${scenario.title.padEnd(width)}  ${paint(scenario.verdict, color)}`);
  }
  const summary = report.summary;
  console.log(
    `\n${summary.honoured} honoured · ${summary.brokenPromise} broken · ${summary.duplicateSideEffect} duplicate · ${summary.prematureIndicator} premature · ${summary.errors} errors`,
  );
  console.log(`runtime ${(report.durationMs / 1000).toFixed(1)}s`);
  if (report.seededDefects.length > 0) {
    const caught = report.seededDefects.filter((defect) => defect.detected).length;
    console.log(`seeded defects ${caught}/${report.seededDefects.length}`);
  }
  if (report.output) {
    console.log(`report ${report.output.html}`);
    if (report.output.witness) console.log(`witness ${report.output.witness}`);
  }
}

function slug(name: string): string {
  const cleaned = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return cleaned || 'probe';
}

async function main(): Promise<void> {
  const flags = parse(process.argv.slice(2));
  if (flags.help || !flags.probe) {
    console.log(usage());
    process.exit(flags.help ? 0 : 2);
  }

  const { contract, file } = await loadProbe(flags.probe);
  const outDir = path.resolve(flags.out ?? path.join('reports', slug(contract.name)));
  const color = Boolean(process.stdout.isTTY);
  let failed = false;

  for (let run = 1; run <= flags.repeat; run += 1) {
    if (flags.repeat > 1) console.log(`\n— run ${run}/${flags.repeat}`);
    const report = await runProbe(contract, {
      outDir: run === flags.repeat ? outDir : undefined,
      reduce: flags.reduce && run === flags.repeat,
      probeFile: file,
    });
    printReport(report, color);
    if (report.summary.errors > 0 || report.summary.honoured !== report.summary.total) failed = true;
  }

  if (flags.strict && failed) process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import {
  request as playwrightRequest,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
  type Request,
} from 'playwright';
import { startApp } from './app-process.js';
import { launchBrowser } from './browser.js';
import { judge } from './judge.js';
import { writeReport } from './output.js';
import { smallestFailing } from './reduce.js';
import { SCENARIO_CATALOG, SCENARIO_ORDER } from './scenarios.js';
import {
  VERSION,
  type PromiseContract,
  type Report,
  type RunContext,
  type ScenarioId,
  type ScenarioResult,
  type ShrinkStep,
  type TimelineEvent,
  type Witness,
} from './types.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const CONTEXT_OPTIONS = { viewport: { width: 1100, height: 800 }, locale: 'en-US' } as const;

export interface ScenarioInput {
  scenario: ScenarioId;
  delayMs?: number;
  runId?: string;
  tracePath?: string;
}

export interface RunOptions {
  outDir?: string;
  /** Shrink failures and confirm them. Default true. */
  reduce?: boolean;
  /** Probe module path written into the generated witness. */
  probeFile?: string;
}

function makeRunId(scenario: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${scenario}-${Date.now().toString(36)}-${rand}`;
}

function urlMatches(url: string, writePath: string): boolean {
  try {
    const pathname = new URL(url).pathname;
    return pathname === writePath || pathname.endsWith(writePath);
  } catch {
    return url.includes(writePath);
  }
}

function hang(releasers: Array<() => void>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    releasers.push(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function releaseAll(releasers: Array<() => void>): void {
  while (releasers.length > 0) releasers.pop()?.();
}

function emptyResult(
  input: ScenarioInput,
  contract: PromiseContract,
  timeline: TimelineEvent[],
  started: number,
): ScenarioResult {
  const meta = SCENARIO_CATALOG[input.scenario];
  const delayMs = input.delayMs ?? contract.responseDelayMs ?? 500;
  return {
    scenario: input.scenario,
    title: meta.title,
    description: meta.description,
    timing: meta.timing,
    delayMs: input.scenario === 'response-delay' ? delayMs : undefined,
    verdict: null,
    flags: [],
    rationale: '',
    indicatorShown: false,
    indicatorAtMs: null,
    responseReceivedAtMs: null,
    durableAtMs: null,
    persistence: null,
    timeline,
    durationMs: Date.now() - started,
  };
}

async function replayAction(page: Page): Promise<void> {
  const ok = await page.evaluate(() => {
    const marked = document.querySelector('[data-promiseprobe-action]');
    const focused = document.activeElement;
    const target = marked ?? (focused instanceof HTMLButtonElement ? focused : null);
    if (!(target instanceof HTMLElement)) return false;
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    return true;
  });
  if (!ok) {
    throw new Error(
      'Double submit could not find the action control. Add data-promiseprobe-action to the button the user activates.',
    );
  }
}

async function installFault(
  page: Page,
  scenario: ScenarioId,
  writePath: string,
  delayMs: number,
  mark: (kind: TimelineEvent['kind'], detail: string) => void,
  releasers: Array<() => void>,
): Promise<void> {
  if (scenario !== 'response-delay' && scenario !== 'request-dropped' && scenario !== 'response-dropped') {
    return;
  }
  let dropped = 0;
  await page.route((url) => url.pathname === writePath, async (route) => {
    try {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      if (scenario === 'request-dropped') {
        mark('fault', 'aborted the request before it reached the server');
        await route.abort('failed');
        return;
      }
      if (scenario === 'response-dropped') {
        if (dropped === 0) {
          dropped += 1;
          mark('fault', 'server committed the write; dropping the response');
          await route.fetch();
          await hang(releasers, 30_000);
          try {
            await route.abort('connectionaborted');
          } catch {
            // The browser already abandoned the request.
          }
          return;
        }
        await route.continue();
        return;
      }
      mark('fault', `holding the response for ${delayMs}ms`);
      await hang(releasers, delayMs);
      await route.continue();
    } catch {
      try {
        await route.abort();
      } catch {
        // The route was already settled by a navigation or a client abort.
      }
    }
  });
}

export async function applyScenario(
  browser: Browser,
  api: APIRequestContext,
  contract: PromiseContract,
  input: ScenarioInput,
): Promise<ScenarioResult> {
  const started = Date.now();
  const now = () => Date.now() - started;
  const timeline: TimelineEvent[] = [];
  const mark = (kind: TimelineEvent['kind'], detail: string) => {
    timeline.push({ t: now(), kind, detail });
  };
  const writePath = contract.writePath ?? '/api/notes';
  const delayMs = input.delayMs ?? contract.responseDelayMs ?? 500;
  const releasers: Array<() => void> = [];
  const runId = input.runId ?? makeRunId(input.scenario);
  const tracePath = input.tracePath;

  let context: BrowserContext | null = null;
  let traced: BrowserContext | null = null;
  let tracing = false;

  const stopTrace = async (): Promise<boolean> => {
    if (!tracing || !traced || !tracePath) return false;
    tracing = false;
    try {
      await mkdir(path.dirname(tracePath), { recursive: true });
      await traced.tracing.stop({ path: tracePath });
      return true;
    } catch {
      return false;
    }
  };

  try {
    context = await browser.newContext(CONTEXT_OPTIONS);
    traced = context;
    if (tracePath) {
      await context.tracing.start({ screenshots: true, snapshots: true });
      tracing = true;
    }
    let page = await context.newPage();
    page.setDefaultTimeout(10_000);

    const ctx: RunContext = {
      page,
      request: api,
      runId,
      appUrl: contract.app.url,
      bag: { runId, text: `Note ${runId}` },
    };

    let indicatorShown = false;
    let indicatorAtMs: number | null = null;
    let responseReceivedAtMs: number | null = null;
    let durableAtMs: number | null = null;
    let seenWrite = false;
    let quietSince: number | null = null;
    const open = new Set<Request>();
    const isWrite = (req: Request) => req.method() === 'POST' && urlMatches(req.url(), writePath);

    page.on('request', (req) => {
      if (!isWrite(req)) return;
      open.add(req);
      seenWrite = true;
      quietSince = null;
      mark('request', `POST ${writePath}`);
    });
    page.on('requestfinished', (req) => {
      if (!open.delete(req)) return;
      if (open.size === 0) quietSince = Date.now();
    });
    page.on('requestfailed', (req) => {
      if (!open.delete(req)) return;
      if (open.size === 0) quietSince = Date.now();
      mark('fault', req.failure()?.errorText ?? 'request failed');
    });
    page.on('response', (res) => {
      const req = res.request();
      if (!isWrite(req) || !res.ok()) return;
      if (responseReceivedAtMs == null) responseReceivedAtMs = now();
      mark('response', `${res.status()} ${writePath}`);
    });

    await installFault(page, input.scenario, writePath, delayMs, mark, releasers);
    await page.goto(contract.app.url, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    mark('navigate', contract.app.url);
    if (contract.prepare) await contract.prepare(ctx);

    if (input.scenario === 'offline') {
      await context.setOffline(true);
      mark('offline', 'browser offline before the action');
    }

    const sample = async () => {
      if (!indicatorShown) {
        try {
          if (await contract.successIndicator(ctx)) {
            indicatorShown = true;
            indicatorAtMs = now();
            mark('indicator', 'success indicator visible');
          }
        } catch {
          // The page can be navigating. The next sample tries again.
        }
      }
      if (contract.durabilitySignal && durableAtMs == null) {
        try {
          if (await contract.durabilitySignal(ctx)) {
            durableAtMs = now();
            mark('durable', 'local write is durable');
          }
        } catch {
          // Same as above: a navigation races the poll.
        }
      }
    };

    mark('action', 'user action');
    await contract.action(ctx);
    if (input.scenario === 'double-submit') {
      await sleep(40);
      mark('action', 'second submit');
      await replayAction(page);
    }

    if (input.scenario === 'restart-after-success') {
      const waitUntil = Date.now() + (contract.indicatorWaitMs ?? 4_000);
      while (!indicatorShown && Date.now() < waitUntil) {
        await sample();
        await sleep(15);
      }
      await sample();
      if (indicatorShown) {
        if (contract.guarantee === 'local') {
          mark('restart', 'reloaded the page');
          await page.reload({ waitUntil: 'domcontentloaded', timeout: 15_000 });
        } else {
          mark('restart', 'closed the browser context');
          await stopTrace();
          releaseAll(releasers);
          await context.close();
          context = await browser.newContext(CONTEXT_OPTIONS);
          page = await context.newPage();
          page.setDefaultTimeout(10_000);
          ctx.page = page;
          await page.goto(contract.app.url, { waitUntil: 'domcontentloaded', timeout: 15_000 });
          mark('navigate', 'reopened the app');
        }
      } else {
        mark('restart', 'success indicator did not appear; left the page in place');
      }
    } else {
      // Wait until write attempts have gone quiet, but never past settleMs.
      // A deferred write (the broken example waits before calling fetch) keeps
      // `seenWrite` false, so the loop does not stop during that gap.
      const deadline = Date.now() + (contract.settleMs ?? 8_000);
      const quietMs = contract.quietMs ?? 800;
      while (Date.now() < deadline) {
        await sample();
        if (seenWrite && open.size === 0 && quietSince != null && Date.now() - quietSince >= quietMs) break;
        await sleep(20);
      }
      await sample();
    }

    const result = emptyResult(input, contract, timeline, started);
    result.indicatorShown = indicatorShown;
    result.indicatorAtMs = indicatorAtMs;
    result.responseReceivedAtMs = responseReceivedAtMs;
    result.durableAtMs = durableAtMs;

    try {
      result.persistence = await contract.persistenceCheck(ctx);
      mark('check', result.persistence.detail ?? `${result.persistence.count} persisted`);
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
      mark('check', `persistence check threw: ${result.error}`);
    }

    if (result.error || !result.persistence) {
      result.error ??= 'persistence check did not return a result';
      result.rationale = result.error;
      result.durationMs = now();
      return result;
    }

    const judgment = judge({
      guarantee: contract.guarantee,
      scenario: input.scenario,
      indicatorShown,
      indicatorAtMs,
      responseReceivedAtMs,
      durableAtMs,
      watchingDurability: Boolean(contract.durabilitySignal),
      persistence: result.persistence,
      expectedCount: contract.expectedCount ?? 1,
    });
    result.verdict = judgment.verdict;
    result.flags = judgment.flags;
    result.rationale = judgment.rationale;
    result.durationMs = now();
    if (await stopTrace()) result.tracePath = tracePath;
    return result;
  } catch (error) {
    const result = emptyResult(input, contract, timeline, started);
    result.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
    result.rationale = result.error;
    result.durationMs = now();
    return result;
  } finally {
    releaseAll(releasers);
    await stopTrace();
    await context?.close().catch(() => undefined);
  }
}

async function reduceFailure(
  browser: Browser,
  api: APIRequestContext,
  contract: PromiseContract,
  failure: ScenarioResult,
  outDir: string | undefined,
): Promise<Witness> {
  const verdict = failure.verdict;
  if (!verdict) throw new Error(`Cannot reduce ${failure.scenario} without a verdict.`);

  let delayMs = failure.delayMs;
  const shrinkSteps: ShrinkStep[] = [];
  if (failure.scenario === 'response-delay') {
    const high = failure.delayMs ?? contract.responseDelayMs ?? 500;
    const shrunk = await smallestFailing(0, high, async (value) => {
      const rerun = await applyScenario(browser, api, contract, {
        scenario: failure.scenario,
        delayMs: value,
        runId: makeRunId(failure.scenario),
      });
      shrinkSteps.push({ delayMs: value, verdict: rerun.verdict });
      return rerun.verdict === verdict;
    });
    if (shrunk.value != null) delayMs = shrunk.value;
  }

  const tracePath = outDir ? path.join(outDir, 'traces', `${failure.scenario}.zip`) : undefined;
  const confirm = await applyScenario(browser, api, contract, {
    scenario: failure.scenario,
    delayMs,
    runId: makeRunId(failure.scenario),
    tracePath,
  });
  const matched = confirm.verdict === verdict;
  return {
    scenario: failure.scenario,
    title: failure.title,
    timing: failure.timing,
    delayMs: failure.scenario === 'response-delay' ? delayMs : undefined,
    verdict,
    rationale: matched ? confirm.rationale : failure.rationale,
    reproducedRuns: matched ? 2 : 1,
    attempts: 2,
    tracePath: matched ? confirm.tracePath : undefined,
    shrinkSteps,
    note: matched ? undefined : 'The confirmation run did not reproduce the original verdict.',
  };
}

function assemble(
  contract: PromiseContract,
  scenarios: ScenarioResult[],
  witnesses: Witness[],
  startedAt: Date,
): Report {
  return {
    version: 1,
    toolVersion: VERSION,
    name: contract.name,
    guarantee: contract.guarantee,
    appUrl: contract.app.url,
    startedAt: startedAt.toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    scenarios,
    witnesses,
    seededDefects: (contract.seededDefects ?? []).map((defect) => ({
      ...defect,
      detected: scenarios.some((scenario) => scenario.scenario === defect.scenario && scenario.verdict === defect.verdict),
    })),
    summary: {
      total: scenarios.length,
      honoured: scenarios.filter((scenario) => scenario.verdict === 'honoured').length,
      brokenPromise: scenarios.filter((scenario) => scenario.verdict === 'broken-promise').length,
      duplicateSideEffect: scenarios.filter((scenario) => scenario.verdict === 'duplicate-side-effect').length,
      prematureIndicator: scenarios.filter((scenario) => scenario.verdict === 'premature-indicator').length,
      errors: scenarios.filter((scenario) => scenario.verdict == null).length,
    },
  };
}

/** Sweep every selected scenario, reduce failures, and optionally write a report. */
export async function runProbe(contract: PromiseContract, options: RunOptions = {}): Promise<Report> {
  const startedAt = new Date();
  const stop = await startApp(contract);
  let browser: Browser | undefined;
  let api: APIRequestContext | undefined;
  try {
    browser = await launchBrowser();
    api = await playwrightRequest.newContext();
    const selected = contract.scenarios ?? [...SCENARIO_ORDER];
    const scenarios: ScenarioResult[] = [];
    for (const scenario of selected) {
      scenarios.push(
        await applyScenario(browser, api, contract, {
          scenario,
          delayMs: scenario === 'response-delay' ? (contract.responseDelayMs ?? 500) : undefined,
          runId: makeRunId(scenario),
        }),
      );
    }

    const witnesses: Witness[] = [];
    if (options.reduce !== false) {
      for (const failure of scenarios) {
        if (!failure.verdict || failure.verdict === 'honoured') continue;
        witnesses.push(await reduceFailure(browser, api, contract, failure, options.outDir));
      }
    }

    const report = assemble(contract, scenarios, witnesses, startedAt);
    if (options.outDir) report.output = await writeReport(report, options.outDir, options.probeFile);
    return report;
  } finally {
    await api?.dispose();
    await browser?.close();
    await stop();
  }
}

/** Re-run one scenario in a fresh browser. The app must already be answering `/health`. */
export async function reproduce(contract: PromiseContract, input: ScenarioInput): Promise<ScenarioResult> {
  const browser = await launchBrowser();
  let api: APIRequestContext | undefined;
  try {
    api = await playwrightRequest.newContext();
    return await applyScenario(browser, api, contract, input);
  } finally {
    await api?.dispose();
    await browser.close();
  }
}
